/**
 * V-PLUGIN-K8S-11: K8s Script config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SEXEC-2, K8SEXEC-3, K8SEXEC-8, K8SEXEC-9, K8SREAD-10,
 *                   K8SREAD-12, K8SREAD-14, K8SWRITE-8
 *
 * Criterion ids use the SC- prefix, following the per-file letter convention
 * v-plugin-k8s-01.spec.ts established.
 *
 * Pass Criteria:
 *   SC-a  four group cards in order Connection / Script / Advanced / Failure
 *         Handling; Advanced and Failure Handling open COLLAPSED, rendering
 *         neither their rows nor their footer, and expand on click; every
 *         expanded card carries its exact footer note; the Secrets collapsible
 *         opens closed
 *   SC-b  every group holds its own rows with their exact labels, in schema
 *         order, and Timeout shows its default 60 in gray, nothing stored (FIELD-2)
 *   SC-c  Interpreter opens on its gray default /bin/sh (FIELD-2), and Script is an
 *         ordinary string row edited through the shared value sheet, not a
 *         tall editor of its own
 *   SC-d  there is NO working-directory row and no Stdin row on this sheet, in
 *         any state, and none of the rows the other K8s blocks own appear
 *   SC-e  nothing on the sheet states which Kubernetes version this block
 *         needs; the Changelog is where that belongs and it carries it
 *   SC-f  K8s Session, Pod, Container and Script are the only rows carrying
 *         the required *, Container included, and every row leads with the (i)
 *         info badge
 *   SC-g  only On error drops the expression toggle; every other row keeps it
 *   SC-h  the info badge of every input row and every output row carries its
 *         exact wording
 *   SC-i  four outputs in order Stdout / Stderr / Exit Code / Success with
 *         their types, none marked Secret; Error and Reason join them only
 *         under Record and continue and leave again on the way back
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { expectStringParamPreview, setStringParam } from '../../helpers/param-config'
import { expectGrayDefault } from '../../helpers/default-rule'
import { expectOnlyRequiredFlags } from '../../helpers/config-sheet'

const GROUP_ORDER = ['Connection', 'Script', 'Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Script': 'The pod and the script to run in it',
  'Advanced':
    'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const CONNECTION_ROWS = ['session', 'timeout']
const SCRIPT_ROWS = ['pod', 'container', 'interpreter', 'script']
const ADVANCED_ROWS = ['namespace', 'impersonate_user', 'impersonate_groups']
const FAILURE_ROWS = ['on_error']

const SHEET_ROWS = [...CONNECTION_ROWS, ...SCRIPT_ROWS, ...ADVANCED_ROWS, ...FAILURE_ROWS]

const GROUP_ROWS: Record<string, string[]> = {
  'Connection': CONNECTION_ROWS,
  'Script': SCRIPT_ROWS,
  'Advanced': ADVANCED_ROWS,
  'Failure Handling': FAILURE_ROWS,
}

const ROW_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  pod: 'Pod',
  container: 'Container',
  interpreter: 'Interpreter',
  script: 'Script',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

/** K8SEXEC-9: Container is required here as it is on every exec-channel block. */
const REQUIRED_ROWS = ['session', 'pod', 'container', 'script']

/** K8SREAD-12: only the row that selects a mode drops the toggle. */
const MODE_ROWS = ['on_error']

/** K8SEXEC-2 / K8SEXEC-3: rows this sheet never offers, plus the rows other
 *  K8s blocks own. */
const ABSENT_ROWS = [
  'working_dir',
  'workdir',
  'working_directory',
  'stdin',
  'command',
  'direction',
  'source_path',
  'target_path',
  'no_preserve',
  'output_format',
  'all_namespaces',
  'kind',
  'resource_type',
  'name',
]

const FOREIGN_GROUPS = [
  'Resource',
  'Events',
  'Logs',
  'Measurement',
  'Scale',
  'Rollout',
  'Command',
  'Copy',
]

/** K8SEXEC-2: the cluster-version floor belongs on the Details page, not here. */
const VERSION_TALK = /1\.30|version/i

const ROW_INFO: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  pod: 'The pod to run the script in.',
  container: 'Which container in the pod to use. Name it even when the pod has only one.',
  interpreter:
    'The interpreter that runs the script. Anything that reads a program on standard input: /bin/sh, bash, python3, perl, node. May include flags.',
  script: 'The script to run. It is fed to the interpreter on standard input.',
  namespace:
    'The namespace the pod is in. Leave empty to use the namespace the session carries.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_ORDER = ['stdout', 'stderr', 'exit_code', 'success']
const OUTPUT_ORDER_RECORD = [...OUTPUT_ORDER, 'error', 'reason']

const OUTPUT_LABELS: Record<string, string> = {
  stdout: 'Stdout',
  stderr: 'Stderr',
  exit_code: 'Exit Code',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const OUTPUT_TYPES: Record<string, string> = {
  stdout: 'string',
  stderr: 'string',
  exit_code: 'integer',
  success: 'boolean',
  error: 'string',
  reason: 'string',
}

const OUTPUT_INFO: Record<string, string> = {
  stdout: 'Everything the command wrote to standard output.',
  stderr: 'Everything the command wrote to standard error.',
  exit_code:
    'The exit code the command returned. A non-zero code is returned as data, not treated as a failure.',
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

const ON_ERROR_OPTIONS = ['Fail the block', 'Record and continue']

/** The cluster-version entry the in-app Changelog carries for 1.0.0. */
const CHANGELOG_VERSION_FLOOR = 'Requires Kubernetes 1.30 or newer'

async function openScriptConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-script' },
    { x: box!.width / 2, y: box!.height / 2 },
  )

  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')

  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

/** Open the sheet with Advanced and Failure Handling already unfolded. */
async function openScriptConfigExpanded(page: Page): Promise<Locator> {
  const modal = await openScriptConfig(page)
  for (const group of COLLAPSED_GROUPS) await expandGroup(modal, group)
  return modal
}

const paramRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-row-${name}"]`)

const outputRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="output-row-${name}"]`)

const groupHeader = (modal: Locator, group: string) =>
  modal.locator(`[data-testid="group-header-${group}"]`)

const groupFooter = (modal: Locator, group: string) =>
  modal.locator(`[data-testid="group-footer-${group}"]`)

const requiredStar = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('td:nth-child(2) span.text-destructive')

/** Expand a collapsible group card. Idempotent. */
async function expandGroup(modal: Locator, group: string) {
  const header = groupHeader(modal, group)
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** The param row ids inside one group card, in DOM order. */
async function groupRowIds(modal: Locator, group: string): Promise<string[]> {
  return groupHeader(modal, group)
    .locator('..')
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

/** The row labels inside one group card, in DOM order, without the required marker. */
async function groupRowLabels(modal: Locator, group: string): Promise<string[]> {
  return groupHeader(modal, group)
    .locator('..')
    .locator('[data-testid^="param-row-"] td:nth-child(2)')
    .evaluateAll((cells) =>
      cells.map((cell) => (cell.textContent ?? '').replace(/\*\s*required$/, '').trim()),
    )
}

/** Every visible input row id on the sheet, in DOM order. */
async function sheetRowIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

async function outputRowIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="output-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', '')),
    )
}

async function pickEnum(page: Page, modal: Locator, name: string, optionLabel: string) {
  const trigger = paramRow(modal, name).locator('button[role="combobox"]')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(trigger).toHaveText(optionLabel)
}

/** Open an enum, read its options in order, close it again without choosing. */
async function readEnumOptions(page: Page, modal: Locator, name: string): Promise<string[]> {
  const trigger = paramRow(modal, name).locator('button[role="combobox"]')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  const options = await listbox.getByRole('option').allTextContents()
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="listbox"]')).toHaveCount(0)
  await expect(modal).toBeVisible()
  return options.map((text) => text.trim())
}

/** Park the pointer on sheet padding so one tooltip closes before the next opens. */
async function dismissTooltip(page: Page, modal: Locator) {
  const box = await modal.boundingBox()
  await page.mouse.move(box!.x + 8, box!.y + box!.height - 8)
  await waitForTooltipClosed(page, 'the tooltip closes', 5_000)
  await expect(
    page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])'),
  ).toHaveCount(0)
}

/** Hover one row's (i) and read the single accessible copy of its tooltip. */
async function expectBadge(page: Page, modal: Locator, row: Locator, label: string, text: string) {
  const badge = row.locator('.cursor-help')
  await badge.scrollIntoViewIfNeeded()
  await badge.hover()
  await waitForTooltipVisible(page, label, 5_000)
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  await expect(tooltip, label).toBeVisible({ timeout: 5_000 })
  // Radix paints the wording twice; [role="tooltip"] is the single accessible copy.
  await expect(tooltip.locator('[role="tooltip"]'), label).toHaveText(text)
  await dismissTooltip(page, modal)
}

test.describe('V-PLUGIN-K8S-11: K8s Script config sheet', () => {
  test('SC-a: four groups in order; Advanced and Failure Handling open collapsed and expand on click', async ({
    page,
  }) => {
    const modal = await openScriptConfig(page)

    await expect(modal.getByRole('heading', { name: 'K8s Script - Edit Config' })).toBeVisible()

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // K8SREAD-10: the sheet opens on the rows an author has to fill in.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Script')).toHaveAttribute('aria-expanded', 'true')
    for (const group of COLLAPSED_GROUPS) {
      await expect(groupHeader(modal, group)).toHaveAttribute('aria-expanded', 'false')
      // A folded card renders neither its rows nor its footer.
      expect(await groupRowIds(modal, group), group).toEqual([])
      await expect(groupFooter(modal, group), group).toHaveCount(0)
    }
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)
    for (const name of [...ADVANCED_ROWS, ...FAILURE_ROWS]) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }

    // The Secrets collapsible sits under the groups and also opens closed.
    await expect(modal.locator('[data-testid="secrets-section-trigger"]')).toHaveAttribute(
      'data-state',
      'closed',
    )

    for (const group of COLLAPSED_GROUPS) await expandGroup(modal, group)

    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(4)
    for (const [group, footer] of Object.entries(GROUP_FOOTERS)) {
      await expect(groupFooter(modal, group), group).toHaveText(footer)
    }

    // No other verb group ever appears on this sheet.
    for (const foreign of FOREIGN_GROUPS) {
      await expect(modal.locator(`[data-testid="group-header-${foreign}"]`), foreign).toHaveCount(0)
    }

    await expectOnlyRequiredFlags(modal)
  })

  test('SC-b: every group holds its own rows and labels in schema order, Timeout showing its gray default 60', async ({
    page,
  }) => {
    const modal = await openScriptConfigExpanded(page)

    for (const [group, rows] of Object.entries(GROUP_ROWS)) {
      expect(await groupRowIds(modal, group), group).toEqual(rows)
      expect(await groupRowLabels(modal, group), group).toEqual(
        rows.map((name) => ROW_LABELS[name]),
      )
    }
    expect(await sheetRowIds(modal)).toEqual(SHEET_ROWS)
    await expect(modal.locator('[data-testid^="param-row-"]')).toHaveCount(SHEET_ROWS.length)

    // The exec-channel blocks wait longer than the read family does; the default shows in gray (FIELD-2).
    await expectGrayDefault(modal, 'timeout', '60')

    expect(await readEnumOptions(page, modal, 'on_error')).toEqual(ON_ERROR_OPTIONS)
    await expect(paramRow(modal, 'on_error').getByRole('combobox')).toHaveText(ON_ERROR_OPTIONS[0])
  })

  test('SC-c: Interpreter opens on /bin/sh, and Script is an ordinary string row', async ({
    page,
  }) => {
    const modal = await openScriptConfigExpanded(page)

    // FIELD-2: nothing is stored; the row opens showing its default in gray.
    await expectGrayDefault(modal, 'interpreter', '/bin/sh')
    await expect(requiredStar(modal, 'interpreter')).toHaveCount(0)
    await expect(paramRow(modal, 'interpreter').locator('td:nth-child(3)')).toHaveText(/string/i)

    // Script edits through the shared value sheet its expand opens, with no editor of its own.
    await expect(modal.locator('[data-testid="param-expand-script"]')).toBeVisible()
    await expect(paramRow(modal, 'script').locator('textarea')).toHaveCount(0)
    await expect(paramRow(modal, 'script').locator('td:nth-child(3)')).toHaveText(/string/i)

    await setStringParam(modal, page, 'script', 'echo hello')
    await expectStringParamPreview(modal, 'script', 'echo hello')

    await setStringParam(modal, page, 'interpreter', 'python3')
    await expectStringParamPreview(modal, 'interpreter', 'python3')
  })

  test('SC-d: there is no working-directory row and no Stdin row on this sheet, in any state', async ({
    page,
  }) => {
    const modal = await openScriptConfigExpanded(page)

    // K8SEXEC-3: kubectl exec has no such flag, so neither does this block.
    for (const name of ABSENT_ROWS) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }
    expect(await groupRowLabels(modal, 'Script')).toEqual([
      'Pod',
      'Container',
      'Interpreter',
      'Script',
    ])

    // Recording the outcome grows the outputs, never the rows.
    await pickEnum(page, modal, 'on_error', 'Record and continue')
    expect(await sheetRowIds(modal)).toEqual(SHEET_ROWS)
  })

  test('SC-e: nothing on the sheet states the Kubernetes version this block needs, and the Changelog does', async ({
    page,
  }) => {
    const modal = await openScriptConfigExpanded(page)

    for (const name of SHEET_ROWS) {
      const text = await paramRow(modal, name).innerText()
      expect(text, `${name} row text`).not.toMatch(VERSION_TALK)
    }
    for (const group of GROUP_ORDER) {
      const footer = await groupFooter(modal, group).innerText()
      expect(footer, `${group} footer`).not.toMatch(VERSION_TALK)
    }
    // The wording SC-h pins verbatim is the wording that reaches the reader.
    for (const [name, info] of Object.entries(ROW_INFO)) {
      expect(info, `${name} badge`).not.toMatch(VERSION_TALK)
    }
    for (const [name, info] of Object.entries(OUTPUT_INFO)) {
      expect(info, `${name} output badge`).not.toMatch(VERSION_TALK)
    }

    // K8SEXEC-2: the Details page is where the floor is stated.
    await modal.getByRole('button', { name: 'Changelog' }).click()
    const changelog = page.locator('[data-testid="changelog-scroll"]')
    await expect(changelog).toBeVisible()
    await expect(changelog).toContainText(CHANGELOG_VERSION_FLOOR)

    await page.keyboard.press('Escape')
    await expect(changelog).toHaveCount(0)
    await expect(modal).toBeVisible()
  })

  test('SC-f: K8s Session, Pod, Container and Script are the only required rows, and every row leads with the info badge', async ({
    page,
  }) => {
    const modal = await openScriptConfigExpanded(page)

    const rows = await sheetRowIds(modal)
    expect(rows).toEqual(SHEET_ROWS)

    const starred: string[] = []
    const badgeless: string[] = []
    for (const name of rows) {
      // The positive count keeps a renamed row from passing the sweep vacuously.
      await expect(paramRow(modal, name), name).toHaveCount(1)
      if ((await requiredStar(modal, name).count()) > 0) starred.push(name)
      if ((await paramRow(modal, name).locator('td').first().locator('svg').count()) === 0) {
        badgeless.push(name)
      }
    }

    // K8SEXEC-9: WAVE never picks a container for the author.
    expect(starred, 'rows carrying the required marker').toEqual(REQUIRED_ROWS)
    await expect(requiredStar(modal, 'container')).toHaveCount(1)
    expect(badgeless, 'rows missing the (i) info badge').toEqual([])

    // FIELDERR-3: a fresh sheet flags its empty required rows at once, and nothing else.
    await expectOnlyRequiredFlags(modal)
  })

  test('SC-g: only On error drops the expression toggle', async ({ page }) => {
    const modal = await openScriptConfigExpanded(page)

    const rows = await sheetRowIds(modal)
    const toggled: string[] = []
    for (const name of rows) {
      await expect(paramRow(modal, name), name).toHaveCount(1)
      if ((await paramRow(modal, name).locator('[data-testid="expression-toggle"]').count()) > 0) {
        toggled.push(name)
      }
    }

    expect(toggled, 'rows offering the expression toggle').toEqual(
      rows.filter((name) => !MODE_ROWS.includes(name)),
    )
    for (const name of MODE_ROWS) {
      await expect(
        paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
        name,
      ).toHaveCount(0)
    }
  })

  test('SC-h: every input and output row carries its exact info badge wording', async ({
    page,
  }) => {
    const modal = await openScriptConfigExpanded(page)

    for (const name of SHEET_ROWS) {
      await expectBadge(page, modal, paramRow(modal, name), name, ROW_INFO[name])
    }

    for (const name of OUTPUT_ORDER) {
      await expectBadge(page, modal, outputRow(modal, name), name, OUTPUT_INFO[name])
    }

    await pickEnum(page, modal, 'on_error', 'Record and continue')
    for (const name of ['error', 'reason']) {
      await expectBadge(page, modal, outputRow(modal, name), name, OUTPUT_INFO[name])
    }
  })

  test('SC-i: Stdout, Stderr, Exit Code and Success, with Error and Reason under Record and continue', async ({
    page,
  }) => {
    const modal = await openScriptConfigExpanded(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUT_ORDER.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUT_ORDER)

    for (const name of ['summary', 'logs', 'status', 'count']) {
      await expect(outputRow(modal, name), name).toHaveCount(0)
    }

    await pickEnum(page, modal, 'on_error', 'Record and continue')
    await expect(outputs).toHaveCount(OUTPUT_ORDER_RECORD.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUT_ORDER_RECORD)

    for (const name of OUTPUT_ORDER_RECORD) {
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(
        OUTPUT_LABELS[name],
      )
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(
        new RegExp(OUTPUT_TYPES[name], 'i'),
      )
      await expect(
        modal.locator(`[data-testid="output-secret-${name}"]`),
        name,
      ).toHaveAttribute('data-state', 'unchecked')
    }

    // K8SWRITE-8: an output the chosen mode cannot fill is absent, not empty.
    await pickEnum(page, modal, 'on_error', 'Fail the block')
    await expect(outputs).toHaveCount(OUTPUT_ORDER.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUT_ORDER)
  })
})
