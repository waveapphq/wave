/**
 * V-PLUGIN-PYTHON-01: Python block config sheet
 * Wireframe: none - the baseline is the four Shell Script config sheet pairs
 *            with the Shell row replaced by Interpreter.
 * Design Decisions: PYRUN-4, PYRUN-5, PYRUN-6, PYRUN-11, PYRUN-13, FIELD-1, FIELD-11
 * REQ: REQ-3.4.1.2, REQ-3.4.3.11
 *
 * Runs in the no-data project list. Each test seeds its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. The rows render in the shipped order, with Interpreter where Shell Script
 *    has Shell: the Script card reads Script Type, Script, Interpreter,
 *    Arguments, the Variables card reads Input Variables, Environment. Each row
 *    carries its label, Type text and (i) badge; Script is the only required
 *    row and takes no expression; Interpreter previews the placeholder
 *    "WAVE's own interpreter" while empty and carries an expression toggle.
 * 2. The Execution card reads Working Directory, Log Output, Timeout, and the
 *    Stop on Pattern card follows it - the schema declares Environment and
 *    Timeout between them, which is why this order differs from Shell Script's.
 *    Working Directory has no value and shows the muted placeholder "System temp
 *    folder" with Browse.
 * 3. The Script body row opens the Python-mode "Edit value" sheet: F1 chip,
 *    Run button and maximize control (the four-corner frame), no Kind and no Format dropdown, and the
 *    saved script in the editor.
 * 4. The Variable Exports table reads Script Variable / Type / Secret / WAVE
 *    Variable with an "Add variable export" footer control; a bound row's Type
 *    select is locked to the bound variable's type and an added, unbound row's
 *    Type is a free select on String.
 * 5. Script Type File shows the Script File row with Browse and hides the
 *    Script body; Source does the reverse and keeps the script.
 * 6. Inside a Remote Execution body the block carries the R locus badge and
 *    drops Browse, because it runs on the remote host.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { expandGroup, openConfig } from '../../functional/file-picker/picker'
import { PYTHON_NODE_ID, deletePythonTest, seedAndOpenPythonTest } from './python-seed'
import { expectStringParamPreview } from '../../helpers/param-config'
import { expectGrayDefault } from '../../helpers/default-rule'

// ---------------------------------------------------------------------------
// Expected sheet content, verbatim from the shipped schema
// ---------------------------------------------------------------------------

const GROUPS = ['Script', 'Variables', 'Execution', 'Stop on Pattern', 'Failure Handling']
const SCRIPT_FOOTER = 'What to run and the arguments it gets'
const VARIABLES_FOOTER = 'Values passed in as globals, and the process environment'
const EXECUTION_FOOTER = 'Where and how long it runs'
const INTERPRETER_PLACEHOLDER = "WAVE's own interpreter"
const PATH_PLACEHOLDER = 'testdata://…, artifact://…, or /abs/path'
const WORKING_DIR_PLACEHOLDER = 'System temp folder'

const LABELS: Record<string, string> = {
  script_type: 'Script Type',
  script: 'Script',
  script_file: 'Script File',
  interpreter: 'Interpreter',
  arguments: 'Arguments',
  input_vars: 'Input Variables',
  environment: 'Environment',
  working_dir: 'Working Directory',
  stream_output: 'Log Output',
  timeout: 'Timeout',
  stop_on_pattern: 'Stop on pattern',
  on_error: 'On error',
}

const TYPES: Record<string, string> = {
  script_type: 'String',
  script: 'String',
  script_file: 'String',
  interpreter: 'String',
  arguments: 'Array',
  input_vars: 'Map',
  environment: 'Map',
  working_dir: 'String',
  stream_output: 'Boolean',
  timeout: 'Integer',
  stop_on_pattern: 'Boolean',
  on_error: 'String',
}

const SCRIPT_ROWS = ['script_type', 'script', 'interpreter', 'arguments']
const FILE_ROWS = ['script_type', 'script_file', 'interpreter', 'arguments']
const VARIABLES_ROWS = ['input_vars', 'environment']
const EXECUTION_ROWS = ['working_dir', 'stream_output', 'timeout']

const ALL_ROWS = [
  ...SCRIPT_ROWS,
  ...VARIABLES_ROWS,
  ...EXECUTION_ROWS,
  'stop_on_pattern',
  'on_error',
]

// ---------------------------------------------------------------------------
// Locators and small helpers
// ---------------------------------------------------------------------------

const created: string[] = []

async function openSheet(page: Page, name: string, remote = false): Promise<Locator> {
  created.push(await seedAndOpenPythonTest(page, name, { remote }))
  return openConfig(page, PYTHON_NODE_ID)
}

const paramRow = (modal: Locator, name: string) => modal.locator(`[data-testid="param-row-${name}"]`)
const exprToggle = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('[data-testid="expression-toggle"]')
const browseButton = (modal: Locator, name: string) => modal.locator(`[data-testid="param-browse-${name}"]`)
// The one value field's text box (FIELD-1).
const editPreview = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('[data-slot="input-group"] input')

/** An empty row shows no value, only its muted italic guidance. */
async function expectGuidance(modal: Locator, name: string, guidance: string): Promise<void> {
  await expect(editPreview(modal, name), `${name} holds no value`).toHaveValue('')
  await expect(editPreview(modal, name)).toHaveAttribute('placeholder', guidance)
}

const requiredStar = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('td:nth-child(2) span.text-destructive')
const enumTrigger = (modal: Locator, name: string) => paramRow(modal, name).locator('button[role="combobox"]')
const exportTable = (modal: Locator) => modal.locator('table:has([data-testid="output-list-name-0"])')

/** The card a group renders as: the header button is its direct child. */
const groupCard = (modal: Locator, name: string) =>
  modal.locator(`div:has(> [data-testid="group-header-${name}"])`)

const testIdsOf = (locator: Locator, prefix: string) =>
  locator.evaluateAll(
    (els, p) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace(p, '')),
    prefix,
  )

async function expectRowIds(scope: Locator, names: string[], label: string): Promise<void> {
  const rows = scope.locator('[data-testid^="param-row-"]')
  await expect(rows, label).toHaveCount(names.length)
  expect(await testIdsOf(rows, 'param-row-'), label).toEqual(names)
}

/** Label, Type text and (i) badge of each named row. */
async function expectRowAnatomy(modal: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    const row = paramRow(modal, name)
    const label = await row
      .locator('td:nth-child(2)')
      .evaluate((cell) => (cell.textContent ?? '').replace(/\*\s*required$/, '').trim())
    expect(label, name).toBe(LABELS[name])
    await expect(row.locator('td:nth-child(3)'), name).toHaveText(TYPES[name], { useInnerText: true })
    await expect(row.locator('td:first-child .cursor-help'), name).toHaveCount(1)
  }
}

async function headerTexts(table: Locator): Promise<string[]> {
  return table.locator('thead th').evaluateAll((cells) => cells.map((c) => (c.textContent ?? '').trim()))
}

async function pickEnum(page: Page, modal: Locator, name: string, optionLabel: string): Promise<void> {
  const trigger = enumTrigger(modal, name)
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(trigger).toHaveText(optionLabel)
}

async function expandAllGroups(modal: Locator): Promise<void> {
  for (const group of GROUPS) await expandGroup(modal, group)
}

// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-PYTHON-01: Python block config sheet', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deletePythonTest(request, testId)
  })

  test('V-PLUGIN-PYTHON-01 rows: the cards, the row order and the Interpreter row', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PYTHON-01 rows')

    await expect(modal.getByRole('heading', { name: 'Python - Edit Config' })).toBeVisible()
    const cards = modal.locator('[data-testid^="group-header-"]')
    expect(await testIdsOf(cards, 'group-header-')).toEqual(GROUPS)

    // Script and Variables open expanded; the Python Variables card carries both maps.
    await expect(modal.locator('[data-testid="group-footer-Script"]')).toHaveText(SCRIPT_FOOTER)
    await expect(modal.locator('[data-testid="group-footer-Variables"]')).toHaveText(VARIABLES_FOOTER)
    await expectRowIds(modal, [...SCRIPT_ROWS, ...VARIABLES_ROWS], 'on open')

    await expandAllGroups(modal)
    await expectRowIds(modal, ALL_ROWS, 'every card expanded')
    await expectRowAnatomy(modal, ALL_ROWS)

    // The Script body is required and never template-expanded (PYRUN-13).
    for (const name of ALL_ROWS) {
      await expect(requiredStar(modal, name), name).toHaveCount(name === 'script' ? 1 : 0)
    }
    await expect(exprToggle(modal, 'script')).toHaveCount(0)
    await expectStringParamPreview(modal, 'script', 'import statistics')

    // Interpreter sits where Shell Script has Shell: empty it paints its
    // guidance as muted italic text, never a value.
    await expectGuidance(modal, 'interpreter', INTERPRETER_PLACEHOLDER)
    await expect(exprToggle(modal, 'interpreter')).toHaveCount(1)
    await expect(paramRow(modal, 'shell')).toHaveCount(0)

    // Both maps sit in the Variables card; Input Variables shows its two entries as one line (FIELD-1).
    await expectRowIds(groupCard(modal, 'Variables'), VARIABLES_ROWS, 'Variables card')
    await expect(editPreview(modal, 'input_vars')).toHaveValue(
      '{"readings": "{{readings}}", "threshold": "{{threshold}}"}',
    )
  })

  test('V-PLUGIN-PYTHON-01 execution: Working Directory, Log Output, Timeout, then the pattern rows', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PYTHON-01 execution')
    await expandAllGroups(modal)

    await expect(modal.locator('[data-testid="group-footer-Execution"]')).toHaveText(EXECUTION_FOOTER)
    await expectRowIds(groupCard(modal, 'Execution'), EXECUTION_ROWS, 'Execution card')
    await expectRowIds(groupCard(modal, 'Stop on Pattern'), ['stop_on_pattern'], 'Stop on Pattern card')

    // Timeout closes the Execution card although the schema declares it after
    // the pattern rows, so the card reads Working Directory, Log Output, Timeout.
    const [logOutput, timeout] = await Promise.all([
      paramRow(modal, 'stream_output').boundingBox(),
      paramRow(modal, 'timeout').boundingBox(),
    ])
    expect(logOutput!.y, 'Log Output sits above Timeout').toBeLessThan(timeout!.y)

    // SHRUN-10: no default value, so the empty row paints only the muted italic placeholder.
    await expectGuidance(modal, 'working_dir', WORKING_DIR_PLACEHOLDER)
    await expect(browseButton(modal, 'working_dir')).toBeVisible()
    await expect(
      paramRow(modal, 'stream_output').locator('button[role="checkbox"]'),
    ).toHaveAttribute('data-state', 'unchecked')
    await expectGrayDefault(modal, 'timeout', '300')
  })

  test('V-PLUGIN-PYTHON-01 script sheet: the Script row opens the Python-mode editor', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PYTHON-01 script sheet')

    await modal.locator('[data-testid="param-expand-script"]').click()
    const sheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('aria-label', 'Edit value')

    // Python mode: the script keys, the Run button and the maximize control.
    await expect(sheet.locator('[data-testid="value-editor-help-chip"]')).toHaveCount(1)
    await expect(sheet.locator('[data-testid="value-editor-run-button"]')).toHaveCount(1)
    await expect(sheet.locator('button[aria-label="Maximize"]')).toHaveCount(1)
    // FIELD-11: full size is the four-corner frame.
    await expect(sheet.locator('button[aria-label="Maximize"] svg.lucide-maximize')).toHaveCount(1)
    await expect(sheet.locator('[data-testid="kind-dropdown"]')).toHaveCount(0)
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toHaveCount(0)

    const content = sheet.locator('.cm-content')
    await expect(content).toContainText('import statistics')
    await expect(content).toContainText('assert len(out_of_range) < 3')
  })

  test('V-PLUGIN-PYTHON-01 exports: the Variable Exports table and its locked types', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PYTHON-01 exports')

    await expect(modal.getByRole('heading', { name: 'Output Variables' })).toBeVisible()
    const exports = exportTable(modal)
    expect(await headerTexts(exports)).toEqual(['', 'Script Variable', 'Type', 'Secret', 'WAVE Variable'])

    for (const [i, name, binding, type] of [
      [0, 'summary', 'summary', 'Map'],
      [1, 'out_of_range', 'out_of_range', 'Array'],
    ] as const) {
      await expect(modal.locator(`[data-testid="output-list-name-${i}"]`), name).toHaveValue(name)
      // Bound to an existing variable, the Type select is locked to its type.
      const typeSelect = modal.locator(`[data-testid="output-list-type-${i}"]`)
      await expect(typeSelect, name).toBeDisabled()
      await expect(typeSelect, name).toHaveText(type)
      await expect(modal.locator(`[data-testid="output-list-secret-${i}"]`), name).toHaveAttribute(
        'data-state',
        'unchecked',
      )
      await expect(
        modal.locator(`[data-testid="output-list-binding-${i}"] [role="combobox"]`),
        name,
      ).toHaveValue(binding)
    }

    const add = modal.locator('[data-testid="output-list-add"]')
    await expect(exports.locator('tfoot [data-testid="output-list-add"]')).toHaveCount(1)
    await expect(add).toHaveText('Add variable export')

    // Unbound, the Type cell is a free select on String.
    await add.click()
    const spareType = modal.locator('[data-testid="output-list-type-2"]')
    await expect(spareType).toBeEnabled()
    await expect(spareType).toHaveText('String')
    await expect(modal.locator('[data-testid="output-list-binding-2"] [role="combobox"]')).toHaveValue('')
  })

  test('V-PLUGIN-PYTHON-01 script type: File swaps the body for a file and Browse', async ({
    page,
  }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PYTHON-01 script type')

    await pickEnum(page, modal, 'script_type', 'File')
    await expectRowIds(groupCard(modal, 'Script'), FILE_ROWS, 'file')
    await expect(paramRow(modal, 'script')).toHaveCount(0)
    await expect(requiredStar(modal, 'script_file')).toHaveCount(1)
    await expectGuidance(modal, 'script_file', PATH_PLACEHOLDER)
    await expect(browseButton(modal, 'script_file')).toBeVisible()
    // Interpreter shows in both Script Types.
    await expectGuidance(modal, 'interpreter', INTERPRETER_PLACEHOLDER)

    await pickEnum(page, modal, 'script_type', 'Source')
    await expectRowIds(groupCard(modal, 'Script'), SCRIPT_ROWS, 'back to source')
    await expect(paramRow(modal, 'script_file')).toHaveCount(0)
    await expectStringParamPreview(modal, 'script', 'import statistics')
    await expect(browseButton(modal, 'script_file')).toHaveCount(0)
  })

  test('V-PLUGIN-PYTHON-01 remote body: the R badge, and Browse leaves with it', async ({ page }) => {
    const modal = await openSheet(page, 'V-PLUGIN-PYTHON-01 remote body', true)

    const badge = page.locator(
      `[data-testid="workflow-node-${PYTHON_NODE_ID}"] [data-testid="node-remote-locus-badge"]`,
    )
    await expect(badge).toHaveAttribute('data-locus', 'R')
    await expect(badge).toHaveText('R')
    await expect(badge).toHaveAttribute('aria-label', 'Runs on the remote host')

    // Nothing on the remote host can be picked from WAVE's file tree.
    await expandGroup(modal, 'Execution')
    await expect(browseButton(modal, 'working_dir')).toHaveCount(0)
    await pickEnum(page, modal, 'script_type', 'File')
    await expect(browseButton(modal, 'script_file')).toHaveCount(0)
  })
})
