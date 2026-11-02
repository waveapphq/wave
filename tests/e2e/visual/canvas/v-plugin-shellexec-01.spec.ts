/**
 * V-PLUGIN-SHELLEXEC-01: Shell Exec config sheet and palette placement
 * Design Decisions: SHRUN-10, SHRUN-13, SHRUN-17, SHRUN-18, SHRUN-19, FIO-11, TDATA-8
 * REQ: REQ-3.4.1.18, REQ-3.4.3.11
 *
 * Runs in the no-data project list. Each test imports its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. On open: the header carries the red Terminal glyph and the title "Shell Exec -
 *    Edit Config"; the group cards run Command, Variables, Execution, Stop on
 *    Pattern, Failure Handling, then Secrets, with Command and Variables expanded
 *    and their footers "The command line and the shell that runs it" and "Values
 *    passed in as environment variables", and every other card collapsed. The rows
 *    are Command, Shell, Input Variables in that order, each with its (i) badge and
 *    Type text. Command is the only required row and its one value field holds
 *    "kubectl get pods -A | grep -c Running" cut at the end, with a toggle; Shell holds
 *    /bin/sh with a toggle; Input Variables holds its two entries as one line with a
 *    toggle. There is no Script Type, Script, Script File, Arguments row or variable
 *    export anywhere on the sheet.
 * 2. Execution expands with the footer "Where and how long it runs" and Stop on
 *    Pattern with "End the command early when a line matches", with the same rows
 *    as Shell Script: Working Directory with no value, the italic hint "System temp
 *    folder", Browse and a toggle, Timeout showing its default 300 in gray and a
 *    toggle, Log Output an unticked checkbox with a toggle, Stop on pattern an
 *    unticked checkbox with no toggle. Ticking Stop on
 *    pattern shows Pass pattern and Fail pattern, Fail pattern carrying the asterisk
 *    and the alert "Set a pass pattern, a fail pattern or both". Browse sits on
 *    Working Directory only.
 * 3. The output section is Stdout, Stderr, Exit Code and Success (String, String,
 *    Integer, Boolean) with no export table and no add button; Record and continue
 *    adds Error and Reason (String) and still no export table.
 * 4. Shell Exec sits right after Shell Script in the System palette group (Shell
 *    Script, Shell Exec, Python, File I/O, Log), and both its palette item and its
 *    plugins flyout item carry the Terminal glyph.
 * 5. "Input Variables" and "Shell" render untruncated.
 * 6. The version selector reads exactly 1.0.0, offers one option and shows no
 *    newer-version arrow.
 * 7. The Changelog dialog's entries name Command, Shell, Input Variables, Working
 *    Directory, Timeout, Log Output, Stop on pattern, Pass pattern, Fail pattern and
 *    On error.
 * 8. Inside a Remote Execution body the block carries the L badge and keeps Browse
 *    on Working Directory, because it runs on WAVE.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { expandPalette } from '../../helpers/canvas'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, expandGroup, openConfig } from '../../functional/file-picker/picker'
import {
  editPreview,
  expectHeldDefault,
} from '../../helpers/config-sheet'

// ---------------------------------------------------------------------------
// Imported Test
// ---------------------------------------------------------------------------

const COMMAND = 'kubectl get pods -A | grep -c Running'
const NODE_ID = 'shell-exec'
const REMOTE_NODE_ID = 'exec-in-body'

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

const shellExecNode = (id: string, position: { x: number; y: number }) =>
  workflowNode(id, 'shell-exec', 'Shell Exec', 'system', position, {
    command: COMMAND,
    shell: '/bin/sh',
    env_vars: { NAMESPACE: 'default', LOG_LEVEL: 'info' },
    stop_on_pattern: false,
  })

const METADATA = { tags: [], suite_id: null, parent_suite: null }

const FIXTURE = () => ({
  name: 'V-PLUGIN-SHELLEXEC-01 sheet',
  version: '1.0.0',
  description: '',
  workflow: {
    nodes: [shellExecNode(NODE_ID, { x: -75, y: 100 })],
    edges: [{ id: 'e-start', source: 'start-node', target: NODE_ID }],
  },
  variables: VARIABLES,
  metadata: METADATA,
})

const REMOTE_FIXTURE = () => ({
  name: 'V-PLUGIN-SHELLEXEC-01 remote body',
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
      shellExecNode(REMOTE_NODE_ID, { x: -75, y: 260 }),
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

const GROUPS = ['Command', 'Variables', 'Execution', 'Stop on Pattern', 'Failure Handling']
const COMMAND_FOOTER = 'The command line and the shell that runs it'
const VARIABLES_FOOTER = 'Values passed in as environment variables'
const EXECUTION_FOOTER = 'Where and how long it runs'
const WORKING_DIR_PLACEHOLDER = 'System temp folder'
const STOP_FOOTER = 'End the command early when a line matches'
const PATTERN_REQUIRED = 'Set a pass pattern, a fail pattern or both'
const SYSTEM_ORDER = ['shell-script', 'shell-exec', 'python', 'file-io', 'log']
const FIXED_OUTPUTS = ['stdout', 'stderr', 'exit_code', 'success']

const LABELS: Record<string, string> = {
  command: 'Command',
  shell: 'Shell',
  env_vars: 'Input Variables',
  working_dir: 'Working Directory',
  timeout: 'Timeout',
  stream_output: 'Log Output',
  stop_on_pattern: 'Stop on pattern',
  pass_pattern: 'Pass pattern',
  fail_pattern: 'Fail pattern',
}

const TYPES: Record<string, string> = {
  command: 'String',
  shell: 'String',
  env_vars: 'Map',
  working_dir: 'String',
  timeout: 'Integer',
  stream_output: 'Boolean',
  stop_on_pattern: 'Boolean',
  pass_pattern: 'String',
  fail_pattern: 'String',
}

const COMMAND_ROWS = ['command', 'shell', 'env_vars']
const EXECUTION_ROWS = ['working_dir', 'timeout', 'stream_output']

// ---------------------------------------------------------------------------
// Locators and small helpers
// ---------------------------------------------------------------------------

const created: string[] = []

async function importTest(page: Page, fixture: Record<string, unknown>): Promise<void> {
  created.push(await importValidateAndNavigate(page, fixture))
}

async function openSheet(page: Page): Promise<Locator> {
  await importTest(page, FIXTURE())
  return openConfig(page, NODE_ID)
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

async function setCheckbox(modal: Locator, name: string, checked: boolean): Promise<void> {
  const state = checked ? 'checked' : 'unchecked'
  const box = checkbox(modal, name)
  await box.scrollIntoViewIfNeeded()
  if ((await box.getAttribute('data-state')) !== state) await box.click()
  await expect(box).toHaveAttribute('data-state', state)
}

/** No export table, no add button and no export row anywhere on the sheet. */
async function expectNoExportTable(modal: Locator): Promise<void> {
  await expect(modal.locator('[data-testid="output-list-add"]')).toHaveCount(0)
  await expect(modal.locator('[data-testid^="output-list-"]')).toHaveCount(0)
  await expect(modal.getByText('Script Variable', { exact: true })).toHaveCount(0)
  await expect(modal.getByText('WAVE Variable', { exact: true })).toHaveCount(0)
}

// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-SHELLEXEC-01: Shell Exec config sheet and palette placement', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test('V-PLUGIN-SHELLEXEC-01 sheet: the Command and Variables cards and nothing script-shaped', async ({
    page,
  }) => {
    const modal = await openSheet(page)

    // SHRUN-19: an Exec block carries Terminal in the System red.
    const heading = modal.getByRole('heading', { name: 'Shell Exec - Edit Config' })
    await expect(heading).toBeVisible()
    await expect(heading.locator('svg.lucide-terminal')).toHaveCount(1)
    await expect(heading.locator('svg.lucide-terminal')).toHaveClass(/\btext-red-500\b/)

    await expect(modal.getByRole('heading', { name: 'Input Parameters' })).toBeVisible()
    const cards = modal.locator('[data-testid^="group-header-"], [data-testid="secrets-section-trigger"]')
    expect(await testIdsOf(cards, 'group-header-')).toEqual([...GROUPS, 'secrets-section-trigger'])
    for (const [name, open] of [
      ['Command', true],
      ['Variables', true],
      ['Execution', false],
      ['Stop on Pattern', false],
      ['Failure Handling', false],
    ] as const) {
      await expect(modal.locator(`[data-testid="group-header-${name}"]`), name).toHaveAttribute(
        'aria-expanded',
        String(open),
      )
    }
    await expect(modal.locator('[data-testid="secrets-section-trigger"]')).toHaveAttribute('aria-expanded', 'false')
    await expect(modal.locator('[data-testid="group-footer-Command"]')).toHaveText(COMMAND_FOOTER)
    await expect(modal.locator('[data-testid="group-footer-Variables"]')).toHaveText(VARIABLES_FOOTER)
    for (const name of ['Execution', 'Stop on Pattern', 'Failure Handling']) {
      await expect(modal.locator(`[data-testid="group-footer-${name}"]`), name).toHaveCount(0)
    }

    await expectRowIds(modal, COMMAND_ROWS, 'on open')
    await expectRowAnatomy(modal, COMMAND_ROWS)
    for (const name of COMMAND_ROWS) {
      await expect(requiredStar(modal, name), name).toHaveCount(name === 'command' ? 1 : 0)
      await expect(exprToggle(modal, name), name).toHaveCount(1)
    }

    const commandText = editPreview(modal, 'command')
    await expect(commandText).toHaveValue(COMMAND)
    expect(await commandText.evaluate((el) => el.scrollWidth > el.clientWidth), 'command cut at the end').toBe(true)
    await expect(editPreview(modal, 'shell')).toHaveValue('/bin/sh')
    await expect(editPreview(modal, 'env_vars')).toHaveValue('{"NAMESPACE": "default", "LOG_LEVEL": "info"}')

    // SHRUN-18: no script source, no arguments, no variable exports.
    for (const name of ['script_type', 'script', 'script_file', 'arguments', 'input_vars', 'script_variables']) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }
    await expect(paramRow(modal, 'arguments'), 'no Arguments row and so no list editor').toHaveCount(0)
    await expect(modal.locator('[data-testid^="param-browse-"]')).toHaveCount(0)

    await expect(modal.getByRole('heading', { name: 'Output Variables' })).toBeVisible()
    await expectOutputIds(modal, FIXED_OUTPUTS, 'outputs on open')
    await expectNoExportTable(modal)
  })

  test('V-PLUGIN-SHELLEXEC-01 execution and stop on pattern: the command footers and the shared rows', async ({
    page,
  }) => {
    const modal = await openSheet(page)

    await expandGroup(modal, 'Execution')
    await expect(modal.locator('[data-testid="group-footer-Execution"]')).toHaveText(EXECUTION_FOOTER)
    await expectRowIds(modal, [...COMMAND_ROWS, ...EXECUTION_ROWS], 'execution expanded')
    await expectRowAnatomy(modal, EXECUTION_ROWS)
    // SHRUN-10: no default value, so the empty field shows only its italic hint.
    await expect(editPreview(modal, 'working_dir')).toHaveValue('')
    await expect(editPreview(modal, 'working_dir')).toHaveAttribute('placeholder', WORKING_DIR_PLACEHOLDER)
    expect(
      await editPreview(modal, 'working_dir').evaluate((el) => getComputedStyle(el, '::placeholder').fontStyle),
      'the hint is italic',
    ).toBe('italic')
    await expect(browseButton(modal, 'working_dir')).toHaveAttribute('aria-label', 'Browse files for Working Directory')
    await expect(exprToggle(modal, 'working_dir')).toHaveCount(1)
    await expectHeldDefault(page, modal, 'timeout', 'integer', '300')
    await expect(exprToggle(modal, 'timeout')).toHaveCount(1)
    await expect(checkbox(modal, 'stream_output')).toHaveAttribute('data-state', 'unchecked')
    await expect(exprToggle(modal, 'stream_output')).toHaveCount(1)

    await expandGroup(modal, 'Stop on Pattern')
    await expect(modal.locator('[data-testid="group-footer-Stop on Pattern"]')).toHaveText(STOP_FOOTER)
    await expectRowAnatomy(modal, ['stop_on_pattern'])
    await expect(checkbox(modal, 'stop_on_pattern')).toHaveAttribute('data-state', 'unchecked')
    await expect(exprToggle(modal, 'stop_on_pattern')).toHaveCount(0)
    await expect(paramRow(modal, 'pass_pattern')).toHaveCount(0)
    await expect(paramRow(modal, 'fail_pattern')).toHaveCount(0)

    await setCheckbox(modal, 'stop_on_pattern', true)
    await expectRowIds(
      modal,
      [...COMMAND_ROWS, ...EXECUTION_ROWS, 'stop_on_pattern', 'pass_pattern', 'fail_pattern'],
      'stop ticked',
    )
    await expectRowAnatomy(modal, ['pass_pattern', 'fail_pattern'])
    await expect(exprToggle(modal, 'pass_pattern')).toHaveCount(1)
    await expect(exprToggle(modal, 'fail_pattern')).toHaveCount(1)
    await expect(requiredStar(modal, 'fail_pattern')).toHaveCount(1)
    await expect(requiredStar(modal, 'pass_pattern')).toHaveCount(0)
    await expect(paramRow(modal, 'fail_pattern').getByRole('alert')).toHaveText(PATTERN_REQUIRED)
    await expect(modal.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

    await expandGroup(modal, 'Failure Handling')
    const browseIds = modal.locator('[data-testid^="param-browse-"]')
    await expect(browseIds).toHaveCount(1)
    expect(await testIdsOf(browseIds, 'param-browse-')).toEqual(['working_dir'])
  })

  test('V-PLUGIN-SHELLEXEC-01 outputs: the fixed rows only, with Error and Reason under Record', async ({
    page,
  }) => {
    const modal = await openSheet(page)

    await expectOutputIds(modal, FIXED_OUTPUTS, 'fail the block')
    for (const [name, label, type] of [
      ['stdout', 'Stdout', 'String'],
      ['stderr', 'Stderr', 'String'],
      ['exit_code', 'Exit Code', 'Integer'],
      ['success', 'Success', 'Boolean'],
    ]) {
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(label)
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(type, { useInnerText: true })
    }
    await expectNoExportTable(modal)

    await expandGroup(modal, 'Failure Handling')
    await expect(enumTrigger(modal, 'on_error')).toHaveText('Fail the block')
    const trigger = enumTrigger(modal, 'on_error')
    await trigger.click()
    const listbox = page.locator('[role="listbox"]')
    await expect(listbox).toBeVisible()
    await listbox.getByRole('option', { name: 'Record and continue', exact: true }).click()
    await expect(listbox).toHaveCount(0)
    await expect(trigger).toHaveText('Record and continue')

    await expectOutputIds(modal, [...FIXED_OUTPUTS, 'error', 'reason'], 'record and continue')
    for (const [name, label] of [
      ['error', 'Error'],
      ['reason', 'Reason'],
    ]) {
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(label)
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText('String', {
        useInnerText: true,
      })
    }
    await expectNoExportTable(modal)
  })

  test('V-PLUGIN-SHELLEXEC-01 palette: right after Shell Script in System, with the Terminal glyph', async ({
    page,
  }) => {
    await importTest(page, FIXTURE())

    await expandPalette(page)
    const system = page.locator('[data-testid="palette-subcat-system"]')
    const header = system.locator('[data-testid="subcategory-header"]')
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(system.locator('[data-testid="subcategory-count"]')).toHaveText('5')

    const systemItems = system.locator('[data-testid^="palette-item-"]')
    await expect(systemItems).toHaveCount(SYSTEM_ORDER.length)
    expect(await testIdsOf(systemItems, 'palette-item-')).toEqual(SYSTEM_ORDER)
    const paletteItem = system.locator('[data-testid="palette-item-shell-exec"]')
    await expect(paletteItem).toBeVisible()
    await expect(paletteItem).toContainText('Shell Exec')
    await expect(paletteItem.locator('svg.lucide-terminal')).toHaveCount(1)
    await expect(paletteItem.locator('svg.lucide-terminal')).toHaveClass(/\btext-red-500\b/)

    // The collapsed strip's plugins flyout lists the same order and glyph.
    await page.locator('[data-testid="palette-collapse-button"]').click()
    await expect(page.locator('[data-testid="block-palette"]')).toHaveAttribute('data-state', 'collapsed')
    await page.locator('[data-testid="palette-icon-plugins"]').click()
    const flyout = page.locator('[data-testid="palette-flyout-plugins"]')
    await expect(flyout).toBeVisible()
    const flyoutIds = await testIdsOf(flyout.locator('[data-testid^="flyout-item-"]'), 'flyout-item-')
    const start = flyoutIds.indexOf('shell-script')
    expect(start, 'Shell Script in the plugins flyout').toBeGreaterThanOrEqual(0)
    expect(flyoutIds.slice(start, start + SYSTEM_ORDER.length)).toEqual(SYSTEM_ORDER)
    const flyoutItem = flyout.locator('[data-testid="flyout-item-shell-exec"]')
    await expect(flyoutItem).toBeVisible()
    await expect(flyoutItem.locator('svg.lucide-terminal')).toHaveCount(1)
  })

  test('V-PLUGIN-SHELLEXEC-01 labels: Input Variables and Shell render whole', async ({ page }) => {
    const modal = await openSheet(page)

    for (const name of ['env_vars', 'shell']) {
      const label = paramRow(modal, name).locator('td:nth-child(2) span').first()
      await expect(label, name).toHaveText(LABELS[name])
      expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), `${name} fits`).toBe(true)
    }
  })

  test('V-PLUGIN-SHELLEXEC-01 version: exactly one version, 1.0.0', async ({ page }) => {
    const modal = await openSheet(page)

    const selector = modal.locator('[data-testid="version-selector"]')
    await expect(selector).toHaveText('1.0.0')
    await expect(modal.locator('[data-testid="version-update-available"]')).toHaveCount(0)

    await selector.click()
    const options = selector.locator('..').locator('ul li button')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('1.0.0')
    await expect(options.first()).toContainText('Current')
  })

  test('V-PLUGIN-SHELLEXEC-01 changelog: the 1.0.0 entries name every setting', async ({ page }) => {
    const modal = await openSheet(page)

    await modal.getByRole('button', { name: 'Changelog' }).click()
    const dialog = page.getByRole('dialog', { name: /- Changelog$/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('li').first()).toBeVisible()

    const entries = (await dialog.locator('li').allTextContents()).join('\n')
    for (const label of [
      'Command',
      'Shell',
      'Input Variables',
      'Working Directory',
      'Timeout',
      'Log Output',
      'Stop on pattern',
      'Pass pattern',
      'Fail pattern',
      'On error',
    ]) {
      expect(entries, label).toContain(label)
    }
  })

  test('V-PLUGIN-SHELLEXEC-01 remote body: the L badge, and Browse stays because the block runs on WAVE', async ({
    page,
  }) => {
    await importTest(page, REMOTE_FIXTURE())

    const badge = page.locator(
      `[data-testid="workflow-node-${REMOTE_NODE_ID}"] [data-testid="node-remote-locus-badge"]`,
    )
    await expect(badge).toHaveAttribute('data-locus', 'L')

    const modal = await openConfig(page, REMOTE_NODE_ID)
    await expandGroup(modal, 'Execution')
    await expect(browseButton(modal, 'working_dir')).toBeVisible()
  })
})
