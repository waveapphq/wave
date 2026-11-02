/**
 * V-STRING-FORMATS: the string watcher Format control and the "Edit value"
 * sheet's Format, REQ-3.1.3.11.
 * Design Decisions: VMGR-65, VMGR-66, VMGR-67, VMGR-68, VMGR-110
 *
 * Phase: fixture (serial) - self-imports one Test via POST /tests carrying string
 * variables whose CONTENT is JSON / a template / plain, then drives the
 * interaction surface (no run; the interaction IS the end-to-end proof - string
 * formats add no plugin/control, so there is no functional spec).
 *
 * Pass Criteria:
 * 1. A JSON-content string watcher renders syntax-highlighted token spans in the
 *    read body and the footer Format trigger reads `Auto (JSON)`.
 * 2. The Format menu lists exactly five entries (Auto / Plain / JSON / XML / YAML);
 *    picking Plain drops the highlight (no token spans), picking YAML restores it.
 *    (Template is a value KIND, not a Format; the {{ }} template-kind
 *    highlight is covered by V-VMGR-08.)
 * 3. The variable's Edit window shows the String Literal on one line with no Format
 *    control; its Open editor shows the "Edit value" sheet, whose Format selector reads
 *    `Auto (JSON)` and whose Format (pretty-print) button expands the single-line
 *    JSON to multiple lines (VMGR-110).
 * 4. Typing invalid JSON in the sheet surfaces an advisory lint marker AND the sheet's
 *    Save stays enabled (a string is always valid).
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import {
  cancelWindow,
  closeValueEditor,
  openEditWindow,
  openValueEditor,
  setValueEditorFormat,
  valueEditor,
  valueEditorCode,
} from '../../helpers/variable-create'

const JSON_CONTENT = '{"name":"alpha","retries":3,"tags":["x","y"],"nested":{"ok":true}}'
const TEMPLATE_CONTENT = 'Hello {{user_name}}, you have {{retries}} retries left.'
const PLAIN_CONTENT = 'first line\nsecond line\nthird line that is quite a bit longer than the others'

function buildFixture() {
  return {
    name: `V-STRING-FORMATS ${Date.now()}`,
    version: '1.0.0',
    description: 'String watchers (JSON / template / plain content) for the string Format control.',
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
      // user_name / retries make the template's {{ }} expressions resolve to known
      // variables (no unknown-variable warning); the cyan highlight is independent.
      user_name: { value: 'bob', type: 'string', scope: 'test' },
      retries: { value: 3, type: 'integer', scope: 'test' },
      payload: { value: JSON_CONTENT, type: 'string', scope: 'test' },
      greeting: { value: TEMPLATE_CONTENT, type: 'string', scope: 'test' },
      notes: { value: PLAIN_CONTENT, type: 'string', scope: 'test' },
    },
    metadata: {},
  }
}

const rowFor = (page: Page, name: string): Locator =>
  page.locator('[data-testid="variable-manager-content"]').locator(`[aria-label="Variable ${name}"]`)
const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)
// Syntax-highlight token spans inside the CodeMirror line. Exclude the always-on
// bracket-match / selection decorations (@uiw basicSetup's bracketMatching paints
// the {} pair regardless of format), so the count reflects language highlighting
// only - plain text then has zero.
const tokenSpans = (modal: Locator): Locator =>
  modal.locator(
    '.cm-content .cm-line span:not(.cm-matchingBracket):not(.cm-nonmatchingBracket):not(.cm-selectionMatch)',
  )

async function importAndOpen(page: Page): Promise<void> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
  const create = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: buildFixture(),
  })
  const body = await create.json().catch(() => null)
  expect(create.ok(), `POST /tests failed: ${create.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = (body.data?.id ?? body.id) as string

  const validate = await page.request.post(`http://localhost:${BACKEND_PORT}/tests/${testId}/validate`)
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
}

// Eye -> read watcher (opens in Current; idle Current falls back to the definition).
async function openRead(page: Page, name: string): Promise<Locator> {
  await rowFor(page, name).hover()
  await rowFor(page, name).locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

async function pickFormat(page: Page, modal: Locator, optionName: string): Promise<void> {
  await modal.locator('[data-testid="format-dropdown"]').click()
  await page.getByRole('option', { name: optionName, exact: true }).click()
}

async function closeInspector(page: Page, name: string): Promise<void> {
  await modalFor(page, name).locator(`[aria-label="Close inspector for ${name}"]`).click()
  await expect(modalFor(page, name)).toHaveCount(0)
}

test.describe('V-STRING-FORMATS: string Format control', () => {
  test('highlight, format menu/switch, pretty-print + advisory lint, template', async ({ page }) => {
    test.setTimeout(120_000)
    await importAndOpen(page)

    await test.step('1/2: JSON read highlight + Auto (JSON) trigger, 5-option menu, Plain drops / YAML restores', async () => {
      const modal = await openRead(page, 'payload')
      // 1: detected JSON -> highlighted token spans + trigger surfaces the format.
      await expect(tokenSpans(modal).first()).toBeVisible()
      const trigger = modal.locator('[data-testid="format-dropdown"]')
      await expect(trigger).toContainText('Auto (JSON)')

      // 2: the menu lists exactly the five data formats (Template is a value KIND,
      // not a Format).
      await trigger.click()
      await expect(page.getByRole('option')).toHaveCount(5)
      for (const name of ['Auto (JSON)', 'Plain', 'JSON', 'XML', 'YAML']) {
        await expect(page.getByRole('option', { name, exact: true })).toBeVisible()
      }
      await page.getByRole('option', { name: 'Plain', exact: true }).click()
      // Plain drops the highlight to flat text.
      await expect(trigger).toContainText('Plain')
      await expect(tokenSpans(modal)).toHaveCount(0)
      // YAML restores highlighting (JSON is valid YAML flow syntax).
      await pickFormat(page, modal, 'YAML')
      await expect(trigger).toContainText('YAML')
      await expect(tokenSpans(modal).first()).toBeVisible()

      await closeInspector(page, 'payload')
    })

    await test.step('3/4: the "Edit value" sheet pretty-prints; invalid JSON -> advisory lint, Save stays enabled', async () => {
      const win = await openEditWindow(page, 'payload')
      // 3: the window holds the String Literal on one line; Format lives only in the sheet.
      await expect(valueEditor(page, win)).toHaveValue(JSON_CONTENT)
      await expect(win.locator('[data-testid="format-dropdown"]')).toHaveCount(0)
      const sheet = await openValueEditor(page, win)
      await expect(sheet.locator('[data-testid="format-dropdown"]')).toContainText('Auto (JSON)')
      const formatButton = sheet.locator('[data-testid="value-editor-string-format-button"]')
      await expect(formatButton).toBeVisible()
      // The single-line JSON draft is one line before formatting.
      await expect(sheet.locator('.cm-content .cm-line')).toHaveCount(1)
      await formatButton.click()
      // Pretty-print expands it to multiple lines.
      await expect(async () => {
        expect(await sheet.locator('.cm-content .cm-line').count()).toBeGreaterThan(1)
      }).toPass({ timeout: 5_000 })

      // 4: invalid JSON -> advisory lint marker, Save NOT gated. Auto detects the
      //    format LIVE from the draft, so invalid JSON re-detects to Plain and drops
      //    the linter; the advisory lint is therefore exercised via an EXPLICIT JSON
      //    pick (which keeps the linter active regardless of validity).
      await setValueEditorFormat(page, sheet, 'JSON')
      const cm = valueEditorCode(sheet)
      await cm.click()
      await page.keyboard.press('Control+a')
      await page.keyboard.type('{ "a": }')
      // jsonParseLinter emits a point diagnostic (from == to) -> @codemirror/lint
      // renders it as a cm-lintPoint widget, not a cm-lintRange underline.
      await expect(
        sheet.locator('.cm-lintPoint-error, .cm-lintRange-error').first(),
      ).toBeAttached({ timeout: 6_000 })
      await expect(sheet.locator('[data-testid="value-editor-save-button"]')).toBeEnabled()

      // Close drops the sheet's draft: the window still holds the saved value and closes at once.
      await closeValueEditor(page, sheet, 'Close')
      await expect(valueEditor(page, win)).toHaveValue(JSON_CONTENT)
      await cancelWindow(page, win)
    })
  })
})
