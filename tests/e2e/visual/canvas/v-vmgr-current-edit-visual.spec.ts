/**
 * V-VMGR-CURRENT-EDIT-VISUAL: Current-value affordances.
 * REQ-3.2.1.6.
 * Design Decisions: VMGR-61, VMGR-62, VMGR-64, VMGR-106, VMGR-108
 *
 * Phase: fixture (serial) - seeds one Test via POST /tests carrying a scalar and
 * a scalar expression, then asserts the idle (no-run) render of:
 *   - the watcher's color-coded Mode pill (indigo Initial / amber Current / neutral
 *     Compare) with its chevron (VMGR-62), and no Edit in the watcher (VMGR-61, VMGR-106);
 *   - the Edit window's value pill: Initial / Current only, indigo then amber (VMGR-108);
 *   - the run-while-editing conflict dialog (VMGR-64);
 *   - the `Last Evaluated` view label and the scalar-expression Compare
 *     (source vs source) + full-height inter-pane divider.
 *
 * Pass Criteria:
 * 1. Watcher Mode pill: Current pill is amber, Initial is indigo, Compare is neutral; the chevron shows.
 * 2. The watcher has no Edit button; the row pencil opens the Edit window on its indigo Initial pill,
 *    whose menu offers exactly Initial and Current; Current turns the pill amber.
 * 3. A run while the Edit window holds an unsaved Current value raises the conflict dialog
 *    `Unsaved Current value` naming the variable, with Cancel / Drop Changes / Save Changes; Cancel
 *    keeps the window and the typed value.
 * 4. An expression's evaluated-view label reads `Last Evaluated`.
 * 5. A scalar-expression Compare shows source vs source with the View pinned to
 *    a disabled `Expression` and a divider that spans the body.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import {
  cancelWindow,
  openEditWindow,
  setValueView,
  setWindowValue,
  valueSwitch,
} from '../../helpers/variable-create'

function buildFixture() {
  return {
    name: `V-VMGR-CURRENT-EDIT-VISUAL ${Date.now()}`,
    version: '1.0.0',
    description: 'Idle scalar + scalar-expression watchers for the Current-edit affordance render.',
    workflow: {
      nodes: [
        {
          id: 'log-anchor',
          type: 'workflowNode',
          position: { x: 320, y: 200 },
          data: {
            label: 'Log',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: { message: "'anchor'", level: 'INFO' }, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [{ id: 'e1', source: 'start-node', target: 'log-anchor', type: 'default' }],
    },
    variables: {
      count: { value: 3, type: 'integer', scope: 'test' },
      factor: { value: 10, type: 'integer', scope: 'test' },
      derived: { value: 'count * factor', type: 'integer', scope: 'test', isExpression: true },
    },
    metadata: {},
  }
}

const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

async function openInspector(page: Page, name: string): Promise<Locator> {
  const row = page
    .locator('[data-testid="variable-manager-content"]')
    .locator(`[aria-label="Variable ${name}"]`)
  await expect(row).toBeVisible()
  await row.hover()
  await row.locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

async function setMode(page: Page, modal: Locator, label: 'Initial' | 'Current' | 'Compare') {
  await modal.locator('[data-testid="mode-dropdown"]').click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

async function closeInspector(page: Page, name: string) {
  await modalFor(page, name).locator(`[aria-label="Close inspector for ${name}"]`).click()
  await expect(modalFor(page, name)).toHaveCount(0)
}

test.describe('V-VMGR-CURRENT-EDIT-VISUAL: Current-edit affordances render', () => {
  test('Mode pill colors, gate, conflict dialog, and expression views', async ({ page }) => {
    test.setTimeout(120_000)
    await ensureEnvironment(page.request)
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    const create = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
      data: buildFixture(),
    })
    const body = await create.json().catch(() => null)
    expect(create.ok(), `POST /tests failed: ${create.status()} - ${JSON.stringify(body)}`).toBeTruthy()
    const testId = (body.data?.id ?? body.id) as string

    const validate = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests/${testId}/validate`,
    )
    const validateBody = await validate.json().catch(() => null)
    const errors = validateBody?.data?.errors ?? validateBody?.error?.details?.[0]?.errors ?? []
    expect(errors, 'fixture must validate with zero errors').toHaveLength(0)

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)
    const panel = page.locator('[data-testid="variable-manager"]')
    if ((await panel.getAttribute('data-state')) === 'collapsed') {
      await panel.locator('button[aria-label="Expand Variable Manager"]').click()
      await expect(panel).toHaveAttribute('data-state', 'expanded')
    }

    await test.step('VMGR-62: the Mode pill is color-coded per mode with a chevron in view', async () => {
      const modal = await openInspector(page, 'count')
      const pill = modal.locator('[data-testid="mode-dropdown"]')
      // Opens in Current: amber pill + chevron.
      await expect(pill).toContainText('Current')
      await expect(pill).toHaveClass(/amber/)
      await expect(modal.locator('[data-testid="mode-pill-chevron"]')).toBeVisible()

      await setMode(page, modal, 'Initial')
      await expect(pill).toContainText('Initial')
      await expect(pill).toHaveClass(/indigo/)

      await setMode(page, modal, 'Compare')
      await expect(pill).toContainText('Compare')
      await expect(pill).not.toHaveClass(/amber/)
      await expect(pill).not.toHaveClass(/indigo/)
      await closeInspector(page, 'count')
    })

    await test.step('VMGR-106 / VMGR-108: no Edit in the watcher; the Edit window pill is Initial / Current', async () => {
      const modal = await openInspector(page, 'count')
      await expect(modal.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
      await expect(modal.locator('[data-testid="mode-pill-chevron"]')).toBeVisible()
      await closeInspector(page, 'count')

      const win = await openEditWindow(page, 'count')
      const pill = valueSwitch(win)
      await expect(pill).toHaveText('Initial')
      await expect(pill).toHaveClass(/indigo/)
      await pill.click()
      await expect(page.getByRole('option')).toHaveText(['Initial', 'Current'])
      await page.getByRole('option', { name: 'Current', exact: true }).click()
      await expect(pill).toHaveText('Current')
      await expect(pill).toHaveClass(/amber/)
      await cancelWindow(page, win)
    })

    await test.step('VMGR-64: a run with an unsaved Current value raises the conflict dialog', async () => {
      await page.locator('[data-testid="environment-selector"]').click()
      const popover = page.locator('[data-testid="environment-popover"]')
      await expect(popover).toBeVisible()
      await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
      await expect(popover).not.toBeVisible()

      const win = await openEditWindow(page, 'count')
      await setValueView(page, win, 'Current')
      await setWindowValue(page, win, 42)
      // The guard intercepts the run while the Current value is unsaved.
      await page.locator('[data-testid="run-button"]').click()
      const dialog = page.locator('[data-testid="current-edit-run-conflict-dialog"]')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading')).toHaveText('Unsaved Current value')
      await expect(dialog.locator('p').first()).toHaveText('This variable has an unsaved Current-value edit: count.')
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Drop Changes', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      // Cancel keeps editing: the window still holds the typed Current value.
      await expect(win.locator('[data-testid="scalar-edit-input"]')).toHaveValue('42')
      await expect(valueSwitch(win)).toHaveText('Current')
      await cancelWindow(page, win, 'Close')
    })

    await test.step('expression evaluated label, Compare source-vs-source, full-height divider', async () => {
      const modal = await openInspector(page, 'derived')
      // The expression's evaluated-value view reads "Last Evaluated".
      await expect(modal.locator('[data-testid="view-dropdown"]')).toContainText('Last Evaluated')

      await setMode(page, modal, 'Compare')
      // A scalar-expression Compare pins the View to a disabled "Expression"
      // and shows the SOURCE in both panes (source vs source, not source vs value).
      await expect(modal.locator('[data-testid="view-dropdown"]')).toContainText('Expression')
      await expect(modal.locator('[data-testid="compare-pane-initial"]')).toContainText(
        'count * factor',
      )
      await expect(modal.locator('[data-testid="compare-pane-current"]')).toContainText(
        'count * factor',
      )

      // The Compare grid fills the (taller) modal body so the inter-pane
      // divider spans the full height instead of stopping at the content height.
      const grid = modal.locator('[data-testid="compare-body"]')
      const wrapper = grid.locator('xpath=..')
      const gridBox = await grid.boundingBox()
      const wrapBox = await wrapper.boundingBox()
      expect(gridBox, 'compare grid box').not.toBeNull()
      expect(wrapBox, 'compare wrapper box').not.toBeNull()
      expect(gridBox!.height).toBeGreaterThanOrEqual(wrapBox!.height - 2)
      await closeInspector(page, 'derived')
    })
  })
})
