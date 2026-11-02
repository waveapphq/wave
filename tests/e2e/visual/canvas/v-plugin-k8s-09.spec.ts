/**
 * V-PLUGIN-K8S-09: K8s Rollout config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SWRITE-7, K8SWRITE-8, K8SREAD-10, K8SREAD-12, K8SREAD-14
 *
 * Criterion ids use the RO- prefix, following the per-file letter convention
 * v-plugin-k8s-01.spec.ts established.
 *
 * Pass Criteria:
 *   RO-a  four group cards in order Connection / Rollout / Advanced / Failure
 *         Handling; Advanced and Failure Handling open COLLAPSED, rendering
 *         neither their rows nor their footer, and expand on click; every
 *         expanded card carries its exact footer note; the Secrets collapsible
 *         opens closed
 *   RO-b  the Rollout group holds Operation / Kind / Name in Restart and in
 *         Status, and To revision joins them last under Undo alone
 *   RO-c  every enum's option list in order with its first option: Operation is
 *         Restart / Status / Undo with no history entry, Kind is the flat three
 *         workload kinds and not the grouped searchable picker, On error is
 *         Fail the block / Record and continue
 *   RO-d  To revision is optional and keeps what was typed across an Operation
 *         round trip through Restart
 *   RO-e  required markers, an info badge on every row, and the expression-
 *         toggle rule: only the two rows that select a mode drop the toggle,
 *         so the enum Kind keeps its own
 *   RO-f  the info badge of every input row and every output row carries its
 *         exact wording
 *   RO-g  Status appears in the OUTPUT VARIABLES table only under Operation =
 *         Status, between Summary and Success, and leaves again on any other
 *         operation
 *   RO-h  the Operation gate and the On error gate are independent: each of the
 *         six Operation by On error combinations renders its own output list
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { expectGrayDefault } from '../../helpers/default-rule'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { expectOnlyRequiredFlags } from '../../helpers/config-sheet'

const GROUP_ORDER = ['Connection', 'Rollout', 'Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Rollout': 'Which workload to restart, report on or roll back',
  'Advanced':
    'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const CONNECTION_ROWS = ['session', 'timeout']
const ADVANCED_ROWS = ['namespace', 'impersonate_user', 'impersonate_groups']
const FAILURE_ROWS = ['on_error']

/** The verb group without and with the one row Undo reveals. */
const ROLLOUT_ROWS = ['operation', 'kind', 'name']
const ROLLOUT_ROWS_UNDO = [...ROLLOUT_ROWS, 'to_revision']

const ROLLOUT_LABELS = ['Operation', 'Kind', 'Name']
const ROLLOUT_LABELS_UNDO = [...ROLLOUT_LABELS, 'To revision']

const SHEET_ROWS = [...CONNECTION_ROWS, ...ROLLOUT_ROWS, ...ADVANCED_ROWS, ...FAILURE_ROWS]
const SHEET_ROWS_UNDO = [
  ...CONNECTION_ROWS,
  ...ROLLOUT_ROWS_UNDO,
  ...ADVANCED_ROWS,
  ...FAILURE_ROWS,
]

/** Kind and Name are required whatever the operation; To revision never is. */
const REQUIRED_ROWS = ['session', 'kind', 'name']

/** K8SREAD-12: a row that SELECTS A MODE resolves while the sheet is authored, so
 *  it drops the toggle. Every other row keeps it, the enum Kind included. */
const MODE_ROWS = ['operation', 'on_error']

const OPERATIONS = ['Restart', 'Status', 'Undo']
const ROLLOUT_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet']
const ON_ERROR_OPTIONS = ['Fail the block', 'Record and continue']

const ROW_INFO: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  operation:
    'Restart replaces the pods with fresh ones. Status reports how the current rollout is going. Undo rolls the workload back to an earlier revision.',
  kind: 'The three kinds that have a rollout. Anything else has no rollout to restart or report on.',
  name: "The object's name.",
  to_revision: 'The revision to roll back to. Leave empty to go back to the previous one.',
  namespace:
    'Leave empty to use the namespace the session carries. Otherwise, the namespace the workload is in.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_LABELS: Record<string, string> = {
  summary: 'Summary',
  status: 'Status',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const OUTPUT_TYPES: Record<string, string> = {
  summary: 'table',
  status: 'string',
  success: 'boolean',
  error: 'string',
  reason: 'string',
}

const OUTPUT_INFO: Record<string, string> = {
  summary:
    "One row per object: the resource, what happened to it, and the cluster's own sentence about the rollout.",
  status:
    'The rollout verdict: complete, progressing or failed. Use it to drive a Wait Until control.',
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

interface OperationCase {
  operation: 'Restart' | 'Status' | 'Undo'
  rows: string[]
  labels: string[]
  /** The OUTPUT VARIABLES table under On error = Fail the block. */
  outputsFail: string[]
  /** The same table under On error = Record and continue. */
  outputsRecord: string[]
}

/** K8SWRITE-8: the Operation gate and the On error gate compose, six states in all. */
const OPERATION_CASES: OperationCase[] = [
  {
    operation: 'Restart',
    rows: ROLLOUT_ROWS,
    labels: ROLLOUT_LABELS,
    outputsFail: ['summary', 'success'],
    outputsRecord: ['summary', 'success', 'error', 'reason'],
  },
  {
    operation: 'Status',
    rows: ROLLOUT_ROWS,
    labels: ROLLOUT_LABELS,
    outputsFail: ['summary', 'status', 'success'],
    outputsRecord: ['summary', 'status', 'success', 'error', 'reason'],
  },
  {
    operation: 'Undo',
    rows: ROLLOUT_ROWS_UNDO,
    labels: ROLLOUT_LABELS_UNDO,
    outputsFail: ['summary', 'success'],
    outputsRecord: ['summary', 'success', 'error', 'reason'],
  },
]

async function openRolloutConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-rollout' },
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
async function openRolloutConfigExpanded(page: Page): Promise<Locator> {
  const modal = await openRolloutConfig(page)
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

test.describe('V-PLUGIN-K8S-09: K8s Rollout config sheet', () => {
  test('RO-a: four groups in order; Advanced and Failure Handling open collapsed and expand on click', async ({
    page,
  }) => {
    const modal = await openRolloutConfig(page)

    await expect(modal.getByRole('heading', { name: 'K8s Rollout - Edit Config' })).toBeVisible()

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // K8SREAD-10: the sheet opens on the rows an author has to fill in.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Rollout')).toHaveAttribute('aria-expanded', 'true')
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
    for (const foreign of ['Resource', 'Events', 'Logs', 'Measurement', 'Scale']) {
      await expect(modal.locator(`[data-testid="group-header-${foreign}"]`), foreign).toHaveCount(0)
    }

    await expectOnlyRequiredFlags(modal)
  })

  test('RO-b: Operation reveals To revision under Undo alone', async ({ page }) => {
    const modal = await openRolloutConfigExpanded(page)

    expect(await groupRowIds(modal, 'Connection')).toEqual(CONNECTION_ROWS)
    expect(await groupRowIds(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    expect(await groupRowIds(modal, 'Failure Handling')).toEqual(FAILURE_ROWS)

    // FIELD-2: Timeout shows its default in gray, not as a typed value.
    await expectGrayDefault(modal, 'timeout', '30')

    for (const operationCase of OPERATION_CASES) {
      await test.step(`Operation ${operationCase.operation}`, async () => {
        await pickEnum(page, modal, 'operation', operationCase.operation)

        expect(await groupRowIds(modal, 'Rollout'), operationCase.operation).toEqual(
          operationCase.rows,
        )
        expect(await groupRowLabels(modal, 'Rollout'), operationCase.operation).toEqual(
          operationCase.labels,
        )
        expect(await sheetRowIds(modal), operationCase.operation).toEqual(
          operationCase.operation === 'Undo' ? SHEET_ROWS_UNDO : SHEET_ROWS,
        )
        // Only Undo carries the revision row, and it lands last in the group.
        await expect(
          paramRow(modal, 'to_revision'),
          operationCase.operation,
        ).toHaveCount(operationCase.operation === 'Undo' ? 1 : 0)
      })
    }

    // Back to the opening state: the revealed row leaves again.
    await pickEnum(page, modal, 'operation', 'Restart')
    expect(await groupRowIds(modal, 'Rollout')).toEqual(ROLLOUT_ROWS)
    await expect(paramRow(modal, 'to_revision')).toHaveCount(0)
  })

  test('RO-c: every enum offers its own options in order, first option first', async ({ page }) => {
    const modal = await openRolloutConfigExpanded(page)

    // K8SWRITE-7: Undo earns an operation and history does not.
    expect(await readEnumOptions(page, modal, 'operation')).toEqual(OPERATIONS)
    await expect(paramRow(modal, 'operation').getByRole('combobox')).toHaveText(OPERATIONS[0])

    // K8SWRITE-7: the three workload kinds that have a rollout, flat, with no
    // Default / Custom pair and no grouped searchable picker.
    expect(await readEnumOptions(page, modal, 'kind')).toEqual(ROLLOUT_KINDS)
    await expect(paramRow(modal, 'kind').getByRole('combobox')).toHaveText(ROLLOUT_KINDS[0])
    await expect(modal.locator('[data-testid="enum-picker-trigger-kind"]')).toHaveCount(0)
    await expect(paramRow(modal, 'resource_type')).toHaveCount(0)
    await expect(paramRow(modal, 'kind_custom')).toHaveCount(0)

    expect(await readEnumOptions(page, modal, 'on_error')).toEqual(ON_ERROR_OPTIONS)
    await expect(paramRow(modal, 'on_error').getByRole('combobox')).toHaveText(ON_ERROR_OPTIONS[0])

    // The lists do not change with the operation.
    await pickEnum(page, modal, 'operation', 'Undo')
    expect(await readEnumOptions(page, modal, 'kind')).toEqual(ROLLOUT_KINDS)
    expect(await readEnumOptions(page, modal, 'operation')).toEqual(OPERATIONS)
  })

  test('RO-d: To revision is optional and keeps what was typed across an Operation round trip', async ({
    page,
  }) => {
    const modal = await openRolloutConfigExpanded(page)

    await pickEnum(page, modal, 'operation', 'Undo')

    const revision = modal.locator('[data-testid="param-input-to_revision"]')
    await expect(revision).toHaveValue('')
    await expect(requiredStar(modal, 'to_revision')).toHaveCount(0)
    await expect(paramRow(modal, 'to_revision').locator('td:nth-child(3)')).toHaveText(/integer/i)

    await revision.scrollIntoViewIfNeeded()
    await revision.fill('3')
    await expect(revision).toHaveValue('3')

    // Restart takes the row away; Undo brings it back with its draft intact.
    await pickEnum(page, modal, 'operation', 'Restart')
    await expect(paramRow(modal, 'to_revision')).toHaveCount(0)
    await pickEnum(page, modal, 'operation', 'Undo')
    await expect(modal.locator('[data-testid="param-input-to_revision"]')).toHaveValue('3')

    // An empty revision is still valid: nothing on the sheet complains.
    await modal.locator('[data-testid="param-input-to_revision"]').fill('')
    await expectOnlyRequiredFlags(modal)
  })

  test('RO-e: required markers, an info badge on every row, and the expression-toggle rule', async ({
    page,
  }) => {
    const modal = await openRolloutConfigExpanded(page)

    for (const operationCase of OPERATION_CASES) {
      await test.step(`Operation ${operationCase.operation}`, async () => {
        await pickEnum(page, modal, 'operation', operationCase.operation)

        const rows = await sheetRowIds(modal)
        expect(rows, operationCase.operation).toEqual(
          operationCase.operation === 'Undo' ? SHEET_ROWS_UNDO : SHEET_ROWS,
        )

        const starred: string[] = []
        const badgeless: string[] = []
        const toggled: string[] = []
        for (const name of rows) {
          const row = paramRow(modal, name)
          await expect(row, name).toHaveCount(1)
          if ((await requiredStar(modal, name).count()) > 0) starred.push(name)
          if ((await row.locator('td').first().locator('svg').count()) === 0) badgeless.push(name)
          if ((await row.locator('[data-testid="expression-toggle"]').count()) > 0) {
            toggled.push(name)
          }
        }

        expect(starred, `${operationCase.operation}: rows carrying the required marker`).toEqual(
          REQUIRED_ROWS,
        )
        expect(badgeless, `${operationCase.operation}: rows missing the (i) info badge`).toEqual([])
        // Only Operation and On error select a mode, so only they drop the toggle.
        expect(
          toggled,
          `${operationCase.operation}: rows offering the expression toggle`,
        ).toEqual(rows.filter((name) => !MODE_ROWS.includes(name)))
      })
    }

    // Kind names the object this block acts on, so the enum keeps its toggle.
    await expect(
      paramRow(modal, 'kind').locator('[data-testid="expression-toggle"]'),
    ).toHaveCount(1)
    for (const name of MODE_ROWS) {
      await expect(
        paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
        name,
      ).toHaveCount(0)
    }
  })

  test('RO-f: every input and output row carries its exact info badge wording', async ({
    page,
  }) => {
    const modal = await openRolloutConfigExpanded(page)

    for (const name of SHEET_ROWS) {
      await expectBadge(page, modal, paramRow(modal, name), name, ROW_INFO[name])
    }

    await pickEnum(page, modal, 'operation', 'Undo')
    await expectBadge(page, modal, paramRow(modal, 'to_revision'), 'to_revision', ROW_INFO['to_revision'])

    for (const name of ['summary', 'success']) {
      await expectBadge(page, modal, outputRow(modal, name), name, OUTPUT_INFO[name])
    }

    await pickEnum(page, modal, 'operation', 'Status')
    await expectBadge(page, modal, outputRow(modal, 'status'), 'status', OUTPUT_INFO['status'])

    await pickEnum(page, modal, 'on_error', 'Record and continue')
    for (const name of ['error', 'reason']) {
      await expectBadge(page, modal, outputRow(modal, name), name, OUTPUT_INFO[name])
    }
  })

  test('RO-g: Status joins the outputs between Summary and Success only under the Status operation', async ({
    page,
  }) => {
    const modal = await openRolloutConfig(page)

    // K8SWRITE-8: an output the chosen mode cannot fill is absent, not empty.
    expect(await outputRowIds(modal)).toEqual(['summary', 'success'])
    await expect(outputRow(modal, 'status')).toHaveCount(0)

    await pickEnum(page, modal, 'operation', 'Status')

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(3)
    expect(await outputRowIds(modal)).toEqual(['summary', 'status', 'success'])
    await expect(outputRow(modal, 'status').locator('td:nth-child(2)')).toHaveText(
      OUTPUT_LABELS['status'],
    )
    await expect(outputRow(modal, 'status').locator('td:nth-child(3)')).toHaveText(/string/i)
    await expect(modal.locator('[data-testid="output-secret-status"]')).toHaveAttribute(
      'data-state',
      'unchecked',
    )

    await pickEnum(page, modal, 'operation', 'Undo')
    await expect(outputs).toHaveCount(2)
    await expect(outputRow(modal, 'status')).toHaveCount(0)

    await pickEnum(page, modal, 'operation', 'Restart')
    await expect(outputs).toHaveCount(2)
    await expect(outputRow(modal, 'status')).toHaveCount(0)

    // Rollout offers no revision, message or replica-count outputs in any mode.
    for (const name of ['message', 'revision', 'desired', 'updated', 'ready', 'available']) {
      await expect(outputRow(modal, name), name).toHaveCount(0)
    }
  })

  test('RO-h: the Operation gate and the On error gate are independent', async ({ page }) => {
    const modal = await openRolloutConfigExpanded(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')

    for (const operationCase of OPERATION_CASES) {
      await test.step(`Operation ${operationCase.operation}`, async () => {
        await pickEnum(page, modal, 'operation', operationCase.operation)

        await pickEnum(page, modal, 'on_error', 'Fail the block')
        await expect(outputs, `${operationCase.operation} / Fail the block`).toHaveCount(
          operationCase.outputsFail.length,
        )
        expect(
          await outputRowIds(modal),
          `${operationCase.operation} / Fail the block`,
        ).toEqual(operationCase.outputsFail)

        await pickEnum(page, modal, 'on_error', 'Record and continue')
        await expect(outputs, `${operationCase.operation} / Record and continue`).toHaveCount(
          operationCase.outputsRecord.length,
        )
        expect(
          await outputRowIds(modal),
          `${operationCase.operation} / Record and continue`,
        ).toEqual(operationCase.outputsRecord)

        for (const name of operationCase.outputsRecord) {
          await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(
            OUTPUT_LABELS[name],
          )
          await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(
            new RegExp(OUTPUT_TYPES[name], 'i'),
          )
        }

        // Back to the default mode: Error and Reason leave again.
        await pickEnum(page, modal, 'on_error', 'Fail the block')
        expect(await outputRowIds(modal), operationCase.operation).toEqual(
          operationCase.outputsFail,
        )
      })
    }
  })
})
