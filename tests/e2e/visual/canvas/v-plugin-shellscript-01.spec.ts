/**
 * V-PLUGIN-SHELLSCRIPT-01: Shell Script config sheet
 * Design Decisions: SHRUN-1, SHRUN-3 to SHRUN-16, SHRUN-19, TDATA-8, TDATA-10, FIELD-1, FIELD-2, FIELD-10
 * REQ: REQ-3.4.1.1, REQ-3.4.2.2, REQ-3.4.3.11
 *
 * Runs in the no-data project list. Each test imports its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. Source state on open: the header carries the red FileTerminal glyph and the
 *    title "Shell Script - Edit Config"; INPUT PARAMETERS reads Parameter / Type /
 *    Value with no tabs; the group cards run Script, Variables, Execution, Stop on
 *    Pattern, Failure Handling, then Secrets, with Script and Variables expanded
 *    and their footers "What to run and the arguments it gets" and "Values passed
 *    in as environment variables", and every other card collapsed with no rows.
 *    The rows are Script Type, Shell, Script, Arguments, Input Variables in that
 *    order, each with its (i) badge and Type text. Script Type is a Source / File
 *    select on Source with no expression toggle; Shell shows its /bin/bash
 *    default in gray with a toggle; Script is the only required row, its one value
 *    field holding the script cut at the end, toggle unpressed. Arguments has no
 *    whole-row toggle and reads the one line `["--env", {{ env.name }}, "3"]`; its
 *    expand opens the shared list editor (FIELD-10) with three items $1 "--env"
 *    (literal, up off), $2 env.name (expression, toggle pressed), $3 "3" (literal,
 *    down off), each with its arrow pair and trash named `Remove argument $n`, then
 *    "Add argument". Input Variables holds its two entries as one line with a toggle.
 * 2. File state: Script Type reads File; Script leaves and Script File takes its
 *    place under Shell, required, with the hint "testdata://…, artifact://…, or
 *    /abs/path" while empty and Browse between the value and the toggle; a set path
 *    keeps the whole path in the hover title, and a long one shows its end (the file
 *    name) while the field has no focus. Shell, Arguments, Input Variables and the collapsed cards are the
 *    same as Source. Back on Source the Script draft is restored, and File again
 *    still holds the path.
 * 3. Stop-pattern state: Execution expands with the footer "Where and how long it
 *    runs": Working Directory has no value and shows the italic hint "System temp
 *    folder" with Browse and a toggle, Timeout shows its default 300 in gray with a
 *    toggle, Log Output is an unticked checkbox with a
 *    toggle. Stop on Pattern expands with the footer "End the
 *    script early when a line matches": Stop on pattern is an unticked checkbox
 *    with no toggle, and Pass pattern and Fail pattern show only while it is
 *    ticked. Ticked with both empty, Fail pattern carries the asterisk and one
 *    alert under it reads exactly "Set a pass pattern, a fail pattern or both",
 *    and the sheet Save and the unsaved-changes Save are both disabled. A Pass
 *    pattern clears the asterisk, the alert and the block on Save; both patterns
 *    hold their values with toggles and survive an untick and re-tick. Failure
 *    Handling and Secrets stay collapsed.
 * 4. Output state: OUTPUT VARIABLES reads Parameter / Type / Secret / Assign to
 *    with Stdout, Stderr, Exit Code, Success (String, String, Integer, Boolean),
 *    each with an unticked Secret box, an empty Assign to reading variable_name
 *    and its (i) badge; Error and Reason are absent under Fail the block. Under
 *    the fixed rows the export table reads Script Variable / Type / Secret / WAVE
 *    Variable: COUNT bound to pod_count with a disabled Type select reading
 *    Integer, STATUS bound to deploy_status with a disabled Type select reading
 *    String, each with an unticked Secret box, a trash and no (i) badge. "Add
 *    variable export" is the table's footer row, aligned to the Script Variable
 *    column. The added row takes focus with no error, shows "Name is required" on
 *    its own table row only after the name field is left while the export row
 *    keeps its one-line height, clears it as a name is typed, and keeps an enabled
 *    Type select reading String while unbound. No
 *    "from variable" text shows. Failure Handling holds On error on Fail the block;
 *    Record and continue adds Error and Reason (String).
 * 5. "Log Output", "Working Directory", "Stop on pattern", "Input Variables",
 *    "Script Type" and "Shell" render untruncated.
 * 6. Browse sits on Script File and Working Directory only, reads "Browse files
 *    for <label>", and leaves a row switched to expression mode.
 * 7. The version selector reads exactly 1.0.0, offers one option and shows no
 *    newer-version arrow.
 * 8. The Changelog dialog's entries name Script Type, Script, Script File, Shell,
 *    Arguments, Input Variables, Working Directory, Timeout, Log Output, Stop on
 *    pattern, Pass pattern, Fail pattern, On error and the variable exports.
 * 9. Inside a Remote Execution body the block carries the L badge and keeps
 *    Browse on Working Directory and Script File, because it runs on WAVE.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import {
  closeValueEditor,
  editPreview,
  expectHeldDefault,
  listAddButton,
  listItems,
  listMoveDown,
  listMoveUp,
  listPositions,
  openListEditor,
  typeFieldText,
} from '../../helpers/config-sheet'
import { listItem } from '../../helpers/entry-editors'
import { deleteTest, expandGroup, openConfig } from '../../functional/file-picker/picker'

// ---------------------------------------------------------------------------
// Imported Test
// ---------------------------------------------------------------------------

const SCRIPT = 'STATUS=$(./deploy.sh "$@") COUNT=$(pgrep -c nginx)'
const SCRIPT_FILE = 'testdata://scripts/deploy.sh'
const LONG_SCRIPT_FILE = 'testdata://scripts/release/2026/october/blue-green/canary/deploy.sh'
const NODE_ID = 'shell-script'
const REMOTE_NODE_ID = 'shell-in-body'

const VARIABLES = {
  pod_count: { value: 0, type: 'integer', scope: 'test' },
  deploy_status: { value: '', type: 'string', scope: 'test' },
  env: { value: { name: 'blue' }, type: 'map', scope: 'test' },
}

function workflowNode(
  id: string,
  elementType: string,
  label: string,
  category: string,
  position: { x: number; y: number },
  values: Record<string, unknown>,
  extra: { expressionFields?: string[]; outputBindings?: Record<string, string>; width?: number } = {},
) {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label,
      elementType,
      nodeType: 'plugin',
      category,
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: extra.expressionFields ?? [],
      templateFields: [],
      config: { values, outputBindings: extra.outputBindings ?? {}, profileBindings: [] },
    },
    measured: { width: extra.width ?? 120, height: 62 },
  }
}

const shellScriptNode = (id: string, position: { x: number; y: number }) =>
  workflowNode(
    id,
    'shell-script',
    'Shell Script',
    'system',
    position,
    {
      script_type: 'source',
      script: SCRIPT,
      arguments: [{ value: '--env' }, { value: 'env.name' }, { value: '3' }],
      input_vars: { TARGET: 'blue', REPLICAS: '3' },
      stop_on_pattern: false,
      script_variables: ['COUNT', 'STATUS'],
    },
    {
      expressionFields: ['arguments.1.value'],
      outputBindings: { COUNT: 'pod_count', STATUS: 'deploy_status' },
    },
  )

const METADATA = { tags: [], suite_id: null, parent_suite: null }

const FIXTURE = () => ({
  name: 'V-PLUGIN-SHELLSCRIPT-01 sheet',
  version: '1.0.0',
  description: '',
  workflow: {
    nodes: [shellScriptNode(NODE_ID, { x: -75, y: 100 })],
    edges: [{ id: 'e-start', source: 'start-node', target: NODE_ID }],
  },
  variables: VARIABLES,
  metadata: METADATA,
})

const REMOTE_FIXTURE = () => ({
  name: 'V-PLUGIN-SHELLSCRIPT-01 remote body',
  version: '1.0.0',
  description: '',
  workflow: {
    nodes: [
      workflowNode(
        'container',
        'remote-execution',
        'Remote Execution',
        'remote',
        { x: -75, y: 100 },
        { session_id: 'sid' },
        { expressionFields: ['session_id'], outputBindings: { remote_session_id: 'rsid' }, width: 160 },
      ),
      shellScriptNode(REMOTE_NODE_ID, { x: -75, y: 260 }),
    ],
    edges: [
      { id: 'e-start', source: 'start-node', target: 'container' },
      { id: 'e-body', source: 'container', sourceHandle: 'body', target: REMOTE_NODE_ID, type: 'default' },
    ],
  },
  variables: {
    ...VARIABLES,
    sid: { value: '', type: 'string', scope: 'test' },
    rsid: { value: '', type: 'string', scope: 'test' },
  },
  metadata: METADATA,
})

// ---------------------------------------------------------------------------
// Expected sheet content, verbatim from the shipped schema
// ---------------------------------------------------------------------------

const GROUPS = ['Script', 'Variables', 'Execution', 'Stop on Pattern', 'Failure Handling']
const SCRIPT_FOOTER = 'What to run and the arguments it gets'
const VARIABLES_FOOTER = 'Values passed in as environment variables'
const EXECUTION_FOOTER = 'Where and how long it runs'
const STOP_FOOTER = 'End the script early when a line matches'
const PATH_PLACEHOLDER = 'testdata://…, artifact://…, or /abs/path'
const WORKING_DIR_PLACEHOLDER = 'System temp folder'
const PATTERN_REQUIRED = 'Set a pass pattern, a fail pattern or both'
const NAME_REQUIRED = 'Name is required'

const LABELS: Record<string, string> = {
  script_type: 'Script Type',
  shell: 'Shell',
  script: 'Script',
  script_file: 'Script File',
  arguments: 'Arguments',
  input_vars: 'Input Variables',
  working_dir: 'Working Directory',
  timeout: 'Timeout',
  stream_output: 'Log Output',
  stop_on_pattern: 'Stop on pattern',
  pass_pattern: 'Pass pattern',
  fail_pattern: 'Fail pattern',
}

const TYPES: Record<string, string> = {
  script_type: 'String',
  shell: 'String',
  script: 'String',
  script_file: 'String',
  arguments: 'Array',
  input_vars: 'Map',
  working_dir: 'String',
  timeout: 'Integer',
  stream_output: 'Boolean',
  stop_on_pattern: 'Boolean',
  pass_pattern: 'String',
  fail_pattern: 'String',
}

const SOURCE_ROWS = ['script_type', 'shell', 'script', 'arguments', 'input_vars']
const FILE_ROWS = ['script_type', 'shell', 'script_file', 'arguments', 'input_vars']
const EXECUTION_ROWS = ['working_dir', 'timeout', 'stream_output']

// ---------------------------------------------------------------------------
// Locators and small helpers
// ---------------------------------------------------------------------------

const created: string[] = []

async function openSheet(page: Page, fixture: Record<string, unknown>, nodeId: string): Promise<Locator> {
  created.push(await importValidateAndNavigate(page, fixture))
  return openConfig(page, nodeId)
}

const paramRow = (modal: Locator, name: string) => modal.locator(`[data-testid="param-row-${name}"]`)
const outputRow = (modal: Locator, name: string) => modal.locator(`[data-testid="output-row-${name}"]`)
const exprToggle = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('[data-testid="expression-toggle"]')
const browseButton = (modal: Locator, name: string) => modal.locator(`[data-testid="param-browse-${name}"]`)
const requiredStar = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('td:nth-child(2) span.text-destructive')
const checkbox = (modal: Locator, name: string) => paramRow(modal, name).locator('button[role="checkbox"]')
const enumTrigger = (modal: Locator, name: string) => paramRow(modal, name).locator('button[role="combobox"]')
const exportTable = (modal: Locator) => modal.locator('table:has([data-testid="output-list-name-0"])')

const testIdsOf = (locator: Locator, prefix: string) =>
  locator.evaluateAll(
    (els, p) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace(p, '')),
    prefix,
  )

async function expectRowIds(modal: Locator, names: string[], label: string): Promise<void> {
  const rows = modal.locator('[data-testid^="param-row-"]')
  await expect(rows, label).toHaveCount(names.length)
  expect(await testIdsOf(rows, 'param-row-'), label).toEqual(names)
}

async function expectOutputIds(modal: Locator, names: string[], label: string): Promise<void> {
  const rows = modal.locator('[data-testid^="output-row-"]')
  await expect(rows, label).toHaveCount(names.length)
  expect(await testIdsOf(rows, 'output-row-'), label).toEqual(names)
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

async function readEnumOptions(page: Page, modal: Locator, name: string): Promise<string[]> {
  const trigger = enumTrigger(modal, name)
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  const options = await listbox.getByRole('option').allTextContents()
  await page.keyboard.press('Escape')
  await expect(listbox).toHaveCount(0)
  return options.map((text) => text.trim())
}

async function setCheckbox(modal: Locator, name: string, checked: boolean): Promise<void> {
  const state = checked ? 'checked' : 'unchecked'
  const box = checkbox(modal, name)
  await box.scrollIntoViewIfNeeded()
  if ((await box.getAttribute('data-state')) !== state) await box.click()
  await expect(box).toHaveAttribute('data-state', state)
}

const overflows = (locator: Locator) => locator.evaluate((el) => el.scrollWidth > el.clientWidth)

/** The value preview, then Browse, then the expression toggle, left to right. */
async function expectBrowseBetweenValueAndToggle(modal: Locator, name: string): Promise<void> {
  const value = await editPreview(modal, name).boundingBox()
  const browse = await browseButton(modal, name).boundingBox()
  const toggle = await exprToggle(modal, name).boundingBox()
  expect(value && browse && toggle, name).toBeTruthy()
  expect(value!.x + value!.width, name).toBeLessThanOrEqual(browse!.x)
  expect(browse!.x + browse!.width, name).toBeLessThanOrEqual(toggle!.x)
}

async function expectGroupState(modal: Locator, expanded: Record<string, boolean>): Promise<void> {
  for (const [name, open] of Object.entries(expanded)) {
    await expect(modal.locator(`[data-testid="group-header-${name}"]`), name).toHaveAttribute(
      'aria-expanded',
      String(open),
    )
    if (!open) await expect(modal.locator(`[data-testid="group-footer-${name}"]`), name).toHaveCount(0)
  }
  await expect(modal.locator('[data-testid="secrets-section-trigger"]')).toHaveAttribute('aria-expanded', 'false')
}

/** Arguments, Input Variables and the collapsed cards read the same in both Script Types. */
async function expectSharedScriptRows(page: Page, modal: Locator): Promise<void> {
  await expect(exprToggle(modal, 'arguments')).toHaveCount(0)
  // FIELD-6, FIELD-10: one line, the {x} item bare; its expand opens the shared list editor.
  await expect(editPreview(modal, 'arguments')).toHaveValue('["--env", {{ env.name }}, "3"]')
  const editor = await openListEditor(page, modal, 'arguments')
  await expect(listItems(editor)).toHaveCount(3)
  expect(await listPositions(editor)).toEqual(['$1', '$2', '$3'])
  for (const i of [0, 1, 2]) {
    await expect(listItem(editor, i).remove).toHaveAccessibleName(`Remove argument $${i + 1}`)
    await expect(listItem(editor, i).remove).toBeEnabled()
  }

  await expect(listItem(editor, 0).valueInput).toHaveValue('--env')
  await expect(listItem(editor, 0).exprToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(listMoveUp(editor, 0)).toHaveAttribute('aria-disabled', 'true')
  await expect(listMoveDown(editor, 0)).not.toHaveAttribute('aria-disabled', 'true')

  await expect(listItem(editor, 1).valueInput).toHaveCount(0)
  await expect(listItem(editor, 1).exprBox.locator('.cm-content')).toHaveText('env.name')
  await expect(listItem(editor, 1).exprToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(listMoveUp(editor, 1)).not.toHaveAttribute('aria-disabled', 'true')
  await expect(listMoveDown(editor, 1)).not.toHaveAttribute('aria-disabled', 'true')

  await expect(listItem(editor, 2).valueInput).toHaveValue('3')
  await expect(listItem(editor, 2).exprToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(listMoveUp(editor, 2)).not.toHaveAttribute('aria-disabled', 'true')
  await expect(listMoveDown(editor, 2)).toHaveAttribute('aria-disabled', 'true')

  const add = listAddButton(editor)
  await expect(add).toHaveText('Add argument')
  await expect(add.locator('svg.lucide-plus')).toHaveCount(1)
  await closeValueEditor(page, editor)

  await expect(editPreview(modal, 'input_vars')).toHaveValue('{"TARGET": "blue", "REPLICAS": "3"}')
  await expect(exprToggle(modal, 'input_vars')).toHaveCount(1)

  await expectGroupState(modal, {
    Script: true,
    Variables: true,
    Execution: false,
    'Stop on Pattern': false,
    'Failure Handling': false,
  })
}

// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-SHELLSCRIPT-01: Shell Script config sheet', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test('V-PLUGIN-SHELLSCRIPT-01 source: the default sheet, its cards, rows and argument list', async ({
    page,
  }) => {
    const modal = await openSheet(page, FIXTURE(), NODE_ID)

    // SHRUN-19: a Script block carries FileTerminal in the System red.
    const heading = modal.getByRole('heading', { name: 'Shell Script - Edit Config' })
    await expect(heading).toBeVisible()
    await expect(heading.locator('svg.lucide-file-terminal')).toHaveCount(1)
    await expect(heading.locator('svg.lucide-file-terminal')).toHaveClass(/\btext-red-500\b/)

    await expect(modal.getByRole('heading', { name: 'Input Parameters' })).toBeVisible()
    const inputTable = modal.locator('table').first()
    expect(await headerTexts(inputTable)).toEqual(['', 'Parameter', 'Type', 'Value'])
    await expect(modal.locator('[role="tablist"]')).toHaveCount(0)

    const cards = modal.locator('[data-testid^="group-header-"], [data-testid="secrets-section-trigger"]')
    expect(await testIdsOf(cards, 'group-header-')).toEqual([...GROUPS, 'secrets-section-trigger'])
    await expect(modal.locator('[data-testid="group-footer-Script"]')).toHaveText(SCRIPT_FOOTER)
    await expect(modal.locator('[data-testid="group-footer-Variables"]')).toHaveText(VARIABLES_FOOTER)

    // The Shell row sits directly under Script Type.
    await expectRowIds(modal, SOURCE_ROWS, 'source on open')
    await expectRowAnatomy(modal, SOURCE_ROWS)
    for (const name of SOURCE_ROWS) {
      await expect(requiredStar(modal, name), name).toHaveCount(name === 'script' ? 1 : 0)
    }
    for (const hidden of ['script_file', ...EXECUTION_ROWS, 'stop_on_pattern', 'on_error']) {
      await expect(paramRow(modal, hidden), hidden).toHaveCount(0)
    }

    await expect(enumTrigger(modal, 'script_type')).toHaveText('Source')
    await expect(exprToggle(modal, 'script_type')).toHaveCount(0)
    expect(await readEnumOptions(page, modal, 'script_type')).toEqual(['Source', 'File'])

    // Shell is unset in the Test, so the row shows its default in gray (FIELD-2).
    await expectHeldDefault(page, modal, 'shell', 'string', '/bin/bash')
    await expect(exprToggle(modal, 'shell')).toHaveCount(1)

    await expect(editPreview(modal, 'script')).toHaveValue(SCRIPT)
    expect(await overflows(editPreview(modal, 'script')), 'script cut at the end').toBe(true)
    await expect(exprToggle(modal, 'script')).toHaveAttribute('aria-pressed', 'false')

    await expect(modal.locator('[data-testid^="param-browse-"]')).toHaveCount(0)
    await expectSharedScriptRows(page, modal)
  })

  test('V-PLUGIN-SHELLSCRIPT-01 file: Script File replaces Script under Shell and each draft is kept', async ({
    page,
  }) => {
    const modal = await openSheet(page, FIXTURE(), NODE_ID)

    await pickEnum(page, modal, 'script_type', 'File')
    await expectRowIds(modal, FILE_ROWS, 'file')
    await expectRowAnatomy(modal, FILE_ROWS)
    await expect(paramRow(modal, 'script')).toHaveCount(0)
    await expect(requiredStar(modal, 'script_file')).toHaveCount(1)

    // Empty, the row shows its guidance as the field's hint, never a value.
    await expect(editPreview(modal, 'script_file')).toHaveValue('')
    await expect(editPreview(modal, 'script_file')).toHaveAttribute('placeholder', PATH_PLACEHOLDER)
    await expect(browseButton(modal, 'script_file')).toBeVisible()
    await expect(exprToggle(modal, 'script_file')).toHaveCount(1)
    await expectBrowseBetweenValueAndToggle(modal, 'script_file')

    await typeFieldText(modal, 'script_file', SCRIPT_FILE)
    await expect(editPreview(modal, 'script_file')).toHaveValue(SCRIPT_FILE)
    // TDATA-8: a set path keeps the whole path in the hover title.
    await expect(paramRow(modal, 'script_file').locator('div[title]')).toHaveAttribute('title', SCRIPT_FILE)

    await expectHeldDefault(page, modal, 'shell', 'string', '/bin/bash')
    await expectSharedScriptRows(page, modal)

    await pickEnum(page, modal, 'script_type', 'Source')
    await expectRowIds(modal, SOURCE_ROWS, 'back to source')
    await expect(editPreview(modal, 'script')).toHaveValue(SCRIPT)

    await pickEnum(page, modal, 'script_type', 'File')
    await expect(editPreview(modal, 'script_file')).toHaveValue(SCRIPT_FILE)

    // TDATA-8: a long path cut by the field shows its end, the file name, once the field has no focus.
    const path = editPreview(modal, 'script_file')
    await typeFieldText(modal, 'script_file', LONG_SCRIPT_FILE)
    await path.press('Tab')
    await expect(path).not.toBeFocused()
    await expect
      .poll(() =>
        path.evaluate((el) => {
          const box = el as HTMLInputElement
          return box.scrollWidth > box.clientWidth && box.scrollLeft + box.clientWidth >= box.scrollWidth - 1
        }),
      )
      .toBe(true)
    await expect(paramRow(modal, 'script_file').locator('div[title]')).toHaveAttribute('title', LONG_SCRIPT_FILE)
  })

  test('V-PLUGIN-SHELLSCRIPT-01 stop-pattern: Execution and Stop on Pattern rows and the at-least-one rule', async ({
    page,
  }) => {
    const modal = await openSheet(page, FIXTURE(), NODE_ID)

    await expandGroup(modal, 'Execution')
    await expect(modal.locator('[data-testid="group-footer-Execution"]')).toHaveText(EXECUTION_FOOTER)
    await expectRowIds(modal, [...SOURCE_ROWS, ...EXECUTION_ROWS], 'execution expanded')
    await expectRowAnatomy(modal, EXECUTION_ROWS)

    // SHRUN-10: no default value, so the empty field shows only its italic hint.
    await expect(editPreview(modal, 'working_dir')).toHaveValue('')
    await expect(editPreview(modal, 'working_dir')).toHaveAttribute('placeholder', WORKING_DIR_PLACEHOLDER)
    expect(
      await editPreview(modal, 'working_dir').evaluate((el) => getComputedStyle(el, '::placeholder').fontStyle),
      'the hint is italic',
    ).toBe('italic')
    await expect(browseButton(modal, 'working_dir')).toBeVisible()
    await expectBrowseBetweenValueAndToggle(modal, 'working_dir')

    await expectHeldDefault(page, modal, 'timeout', 'integer', '300')
    await expect(exprToggle(modal, 'timeout')).toHaveCount(1)

    await expect(checkbox(modal, 'stream_output')).toHaveAttribute('data-state', 'unchecked')
    await expect(exprToggle(modal, 'stream_output')).toHaveCount(1)
    await setCheckbox(modal, 'stream_output', true)

    await expandGroup(modal, 'Stop on Pattern')
    await expect(modal.locator('[data-testid="group-footer-Stop on Pattern"]')).toHaveText(STOP_FOOTER)
    await expectRowIds(modal, [...SOURCE_ROWS, ...EXECUTION_ROWS, 'stop_on_pattern'], 'stop unticked')
    await expectRowAnatomy(modal, ['stop_on_pattern'])
    await expect(checkbox(modal, 'stop_on_pattern')).toHaveAttribute('data-state', 'unchecked')
    await expect(exprToggle(modal, 'stop_on_pattern')).toHaveCount(0)

    await setCheckbox(modal, 'stop_on_pattern', true)
    await expectRowIds(
      modal,
      [...SOURCE_ROWS, ...EXECUTION_ROWS, 'stop_on_pattern', 'pass_pattern', 'fail_pattern'],
      'stop ticked',
    )
    await expectRowAnatomy(modal, ['pass_pattern', 'fail_pattern'])

    // Both patterns empty: the rule shows at once, on Fail pattern only.
    await expect(requiredStar(modal, 'fail_pattern')).toHaveCount(1)
    await expect(requiredStar(modal, 'pass_pattern')).toHaveCount(0)
    await expect(paramRow(modal, 'fail_pattern').getByRole('alert')).toHaveText(PATTERN_REQUIRED)
    await expect(modal.getByRole('alert').filter({ hasText: PATTERN_REQUIRED })).toHaveCount(1)
    const save = modal.getByRole('button', { name: 'Save', exact: true })
    await expect(save).toBeDisabled()

    // The unsaved-changes prompt offers no way past the rule either.
    await modal.locator('button[aria-label="Close"]').click()
    const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' })
    await expect(unsaved).toBeVisible()
    await expect(unsaved.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await unsaved.getByRole('button', { name: 'Keep Editing' }).click()
    await expect(unsaved).toBeHidden()
    await expect(modal).toBeVisible()

    await typeFieldText(modal, 'pass_pattern', '^Server started')
    await expect(requiredStar(modal, 'fail_pattern')).toHaveCount(0)
    await expect(modal.getByRole('alert').filter({ hasText: PATTERN_REQUIRED })).toHaveCount(0)
    await expect(save).toBeEnabled()

    await typeFieldText(modal, 'fail_pattern', 'ERROR|FATAL')
    await expect(editPreview(modal, 'pass_pattern')).toHaveValue('^Server started')
    await expect(editPreview(modal, 'fail_pattern')).toHaveValue('ERROR|FATAL')
    await expect(exprToggle(modal, 'pass_pattern')).toHaveCount(1)
    await expect(exprToggle(modal, 'fail_pattern')).toHaveCount(1)
    await expect(checkbox(modal, 'stream_output')).toHaveAttribute('data-state', 'checked')

    await setCheckbox(modal, 'stop_on_pattern', false)
    await expect(paramRow(modal, 'pass_pattern')).toHaveCount(0)
    await expect(paramRow(modal, 'fail_pattern')).toHaveCount(0)
    await setCheckbox(modal, 'stop_on_pattern', true)
    await expect(editPreview(modal, 'pass_pattern')).toHaveValue('^Server started')
    await expect(editPreview(modal, 'fail_pattern')).toHaveValue('ERROR|FATAL')

    await expect(modal.locator('[data-testid="group-header-Failure Handling"]')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(modal.locator('[data-testid="secrets-section-trigger"]')).toHaveAttribute('aria-expanded', 'false')
  })

  test('V-PLUGIN-SHELLSCRIPT-01 output: fixed rows, the variable export table and the Record gate', async ({
    page,
  }) => {
    const modal = await openSheet(page, FIXTURE(), NODE_ID)

    await expect(modal.getByRole('heading', { name: 'Output Variables' })).toBeVisible()
    const fixedTable = modal.locator('table:has([data-testid="output-row-stdout"])')
    expect(await headerTexts(fixedTable)).toEqual(['', 'Parameter', 'Type', 'Secret', 'Assign to'])

    await expectOutputIds(modal, ['stdout', 'stderr', 'exit_code', 'success'], 'fail the block')
    for (const [name, label, type] of [
      ['stdout', 'Stdout', 'String'],
      ['stderr', 'Stderr', 'String'],
      ['exit_code', 'Exit Code', 'Integer'],
      ['success', 'Success', 'Boolean'],
    ]) {
      const row = outputRow(modal, name)
      await expect(row.locator('td:nth-child(2)'), name).toHaveText(label)
      await expect(row.locator('td:nth-child(3)'), name).toHaveText(type, { useInnerText: true })
      await expect(row.locator('td:first-child .cursor-help'), name).toHaveCount(1)
      await expect(modal.locator(`[data-testid="output-secret-${name}"]`), name).toHaveAttribute(
        'data-state',
        'unchecked',
      )
      const assign = row.locator('[role="combobox"]')
      await expect(assign, name).toHaveAttribute('placeholder', 'variable_name')
      await expect(assign, name).toHaveValue('')
    }

    // SHRUN-6: the export table closes the section, under the fixed rows.
    const exports = exportTable(modal)
    expect(await headerTexts(exports)).toEqual(['', 'Script Variable', 'Type', 'Secret', 'WAVE Variable'])
    const fixedBox = await fixedTable.boundingBox()
    const exportsBox = await exports.boundingBox()
    expect(exportsBox!.y, 'export table sits under the fixed rows').toBeGreaterThanOrEqual(
      fixedBox!.y + fixedBox!.height,
    )

    for (const [i, name, binding, type] of [
      [0, 'COUNT', 'pod_count', 'Integer'],
      [1, 'STATUS', 'deploy_status', 'String'],
    ] as const) {
      const nameInput = modal.locator(`[data-testid="output-list-name-${i}"]`)
      await expect(nameInput, name).toHaveValue(name)
      await expect(nameInput, name).toHaveClass(/\bfont-mono\b/)
      await expect(nameInput, name).toHaveAttribute('aria-label', `Variable export ${i + 1} name`)
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
      await expect(modal.locator(`[data-testid="output-list-remove-${i}"]`), name).toHaveAttribute(
        'aria-label',
        `Remove variable export ${i + 1}`,
      )
      await expect(exports.locator(`tr:has([data-testid="output-list-name-${i}"]) .cursor-help`), name).toHaveCount(
        0,
      )
    }

    // The add button is the table's footer row, lined up with the Script Variable column.
    const add = modal.locator('[data-testid="output-list-add"]')
    await expect(exports.locator('tfoot [data-testid="output-list-add"]')).toHaveCount(1)
    await expect(add).toHaveText('Add variable export')
    await expect(add.locator('svg.lucide-plus')).toHaveCount(1)
    const addBox = await add.boundingBox()
    const nameBox = await modal.locator('[data-testid="output-list-name-0"]').boundingBox()
    expect(Math.abs(addBox!.x - nameBox!.x), 'add aligned to Script Variable').toBeLessThanOrEqual(1)

    await add.click()
    const spareName = modal.locator('[data-testid="output-list-name-2"]')
    await expect(spareName).toBeFocused()
    await expect(spareName).toHaveValue('')
    await expect(exports.getByRole('alert')).toHaveCount(0)
    const spareRow = exports.locator('tr:has([data-testid="output-list-name-2"])')
    const rowBefore = await spareRow.boundingBox()

    // The name error waits until the field is left, on its own row under the export row.
    await page.keyboard.press('Tab')
    await expect(exports.locator('tr:has([data-testid="output-list-name-2"]) + tr [role="alert"]')).toHaveText(
      NAME_REQUIRED,
    )
    await expect(spareRow.locator('[role="alert"]')).toHaveCount(0)
    const rowAfter = await spareRow.boundingBox()
    expect(Math.abs(rowAfter!.height - rowBefore!.height), 'the export row keeps one line').toBeLessThanOrEqual(1)
    await spareName.fill('SPARE')
    await expect(exports.getByRole('alert')).toHaveCount(0)

    // Unbound, the Type cell is a free select on String.
    const spareType = modal.locator('[data-testid="output-list-type-2"]')
    await expect(spareType).toBeEnabled()
    await expect(spareType).toHaveText('String')
    await expect(modal.locator('[data-testid="output-list-binding-2"] [role="combobox"]')).toHaveValue('')
    await expect(modal.locator('[data-testid="output-list-secret-2"]')).toHaveAttribute('data-state', 'unchecked')
    await expect(modal.getByText('from variable')).toHaveCount(0)

    await expandGroup(modal, 'Failure Handling')
    await expect(enumTrigger(modal, 'on_error')).toHaveText('Fail the block')
    await expect(exprToggle(modal, 'on_error')).toHaveCount(0)
    expect(await readEnumOptions(page, modal, 'on_error')).toEqual(['Fail the block', 'Record and continue'])
    await expectOutputIds(modal, ['stdout', 'stderr', 'exit_code', 'success'], 'still fail the block')

    await pickEnum(page, modal, 'on_error', 'Record and continue')
    await expectOutputIds(modal, ['stdout', 'stderr', 'exit_code', 'success', 'error', 'reason'], 'record')
    for (const [name, label] of [
      ['error', 'Error'],
      ['reason', 'Reason'],
    ]) {
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(label)
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText('String', {
        useInnerText: true,
      })
    }
  })

  test('V-PLUGIN-SHELLSCRIPT-01 labels: the long labels render whole', async ({ page }) => {
    const modal = await openSheet(page, FIXTURE(), NODE_ID)
    await expandGroup(modal, 'Execution')
    await expandGroup(modal, 'Stop on Pattern')

    for (const name of ['stream_output', 'working_dir', 'stop_on_pattern', 'input_vars', 'script_type', 'shell']) {
      const label = paramRow(modal, name).locator('td:nth-child(2) span').first()
      await label.scrollIntoViewIfNeeded()
      await expect(label, name).toHaveText(LABELS[name])
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), `${name} fits`).toBe(true)
    }
  })

  test('V-PLUGIN-SHELLSCRIPT-01 browse: only Script File and Working Directory, and never in expression mode', async ({
    page,
  }) => {
    const modal = await openSheet(page, FIXTURE(), NODE_ID)
    for (const group of ['Execution', 'Stop on Pattern', 'Failure Handling']) await expandGroup(modal, group)
    await setCheckbox(modal, 'stop_on_pattern', true)

    const browseIds = modal.locator('[data-testid^="param-browse-"]')
    await expect(browseIds).toHaveCount(1)
    expect(await testIdsOf(browseIds, 'param-browse-')).toEqual(['working_dir'])

    await pickEnum(page, modal, 'script_type', 'File')
    await expect(browseIds).toHaveCount(2)
    expect(await testIdsOf(browseIds, 'param-browse-')).toEqual(['script_file', 'working_dir'])
    for (const name of ['script_file', 'working_dir']) {
      await expect(browseButton(modal, name)).toHaveAttribute('aria-label', `Browse files for ${LABELS[name]}`)
    }

    // An expression names the path at run time, so there is nothing to pick.
    for (const name of ['script_file', 'working_dir']) {
      await exprToggle(modal, name).click()
      await expect(exprToggle(modal, name)).toHaveAttribute('aria-pressed', 'true')
      await expect(browseButton(modal, name), name).toHaveCount(0)
      await exprToggle(modal, name).click()
      await expect(exprToggle(modal, name)).toHaveAttribute('aria-pressed', 'false')
      await expect(browseButton(modal, name), name).toBeVisible()
    }
  })

  test('V-PLUGIN-SHELLSCRIPT-01 version: exactly one version, 1.0.0', async ({ page }) => {
    const modal = await openSheet(page, FIXTURE(), NODE_ID)

    const selector = modal.locator('[data-testid="version-selector"]')
    await expect(selector).toHaveText('1.0.0')
    await expect(modal.locator('[data-testid="version-update-available"]')).toHaveCount(0)

    await selector.click()
    const options = selector.locator('..').locator('ul li button')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('1.0.0')
    await expect(options.first()).toContainText('Current')
  })

  test('V-PLUGIN-SHELLSCRIPT-01 changelog: the 1.0.0 entries name every setting', async ({ page }) => {
    const modal = await openSheet(page, FIXTURE(), NODE_ID)

    await modal.getByRole('button', { name: 'Changelog' }).click()
    const dialog = page.getByRole('dialog', { name: /- Changelog$/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('li').first()).toBeVisible()

    const entries = (await dialog.locator('li').allTextContents()).join('\n')
    for (const label of [
      'Script Type',
      'Script',
      'Script File',
      'Shell',
      'Arguments',
      'Input Variables',
      'Working Directory',
      'Timeout',
      'Log Output',
      'Stop on pattern',
      'Pass pattern',
      'Fail pattern',
      'On error',
      'Variable exports',
    ]) {
      expect(entries, label).toContain(label)
    }
  })

  test('V-PLUGIN-SHELLSCRIPT-01 remote body: the L badge, and Browse stays because the block runs on WAVE', async ({
    page,
  }) => {
    created.push(await importValidateAndNavigate(page, REMOTE_FIXTURE()))

    const badge = page.locator(
      `[data-testid="workflow-node-${REMOTE_NODE_ID}"] [data-testid="node-remote-locus-badge"]`,
    )
    await expect(badge).toHaveAttribute('data-locus', 'L')

    const modal = await openConfig(page, REMOTE_NODE_ID)
    await expandGroup(modal, 'Execution')
    await expect(browseButton(modal, 'working_dir')).toBeVisible()
    await pickEnum(page, modal, 'script_type', 'File')
    await expect(browseButton(modal, 'script_file')).toBeVisible()
  })
})
