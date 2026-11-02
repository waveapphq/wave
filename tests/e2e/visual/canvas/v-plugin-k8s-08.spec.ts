/**
 * V-PLUGIN-K8S-08: K8s Scale config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SWRITE-6, K8SWRITE-8, K8SREAD-10, K8SREAD-12, K8SREAD-14
 *
 * Criterion ids use the SC- prefix, following the per-file letter convention
 * v-plugin-k8s-01.spec.ts established.
 *
 * Pass Criteria:
 *   SC-a  four group cards in order Connection / Scale / Advanced / Failure
 *         Handling; Advanced and Failure Handling open COLLAPSED, rendering
 *         neither their rows nor their footer, and expand on click; every
 *         expanded card carries its exact footer note; the Secrets collapsible
 *         opens closed
 *   SC-b  the Scale group holds exactly four rows, Resource Type / Kind / Name /
 *         Replicas, in BOTH Resource Type states, and the whole sheet holds the
 *         same ten labels in the same order in both
 *   SC-c  Resource Type Default and Custom swap the Kind control between the
 *         four-option enum and a plain string field, and change nothing else on
 *         the sheet
 *   SC-d  every enum's option list in order with its first option: Resource
 *         Type, Kind and On error; Kind is the flat four-option list, not the
 *         grouped searchable picker
 *   SC-e  both Kind rows keep what was typed across a Resource Type round trip,
 *         and neither inherits the other's value
 *   SC-f  required markers, an info badge on every row, and the expression-
 *         toggle rule: only the two rows that select a mode drop the toggle
 *   SC-g  the info badge of every input row and every output row carries its
 *         exact wording
 *   SC-h  no precondition pair, no wait row and no second timeout, in either
 *         Resource Type state
 *   SC-i  two outputs as the sheet opens, Summary then Success; Record and
 *         continue adds Error then Reason after Success, and Fail the block
 *         takes them away again
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { expectStringParamPreview, setStringParam } from '../../helpers/param-config'
import { expectGrayDefault } from '../../helpers/default-rule'
import { expectOnlyRequiredFlags } from '../../helpers/config-sheet'

const GROUP_ORDER = ['Connection', 'Scale', 'Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Scale': 'What to scale and to how many',
  'Advanced':
    'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const CONNECTION_ROWS = ['session', 'timeout']
const ADVANCED_ROWS = ['namespace', 'impersonate_user', 'impersonate_groups']
const FAILURE_ROWS = ['on_error']

/** The verb group in Resource Type = Default, and in Custom. */
const SCALE_ROWS_DEFAULT = ['resource_type', 'kind', 'name', 'replicas']
const SCALE_ROWS_CUSTOM = ['resource_type', 'kind_custom', 'name', 'replicas']

/** The Scale group reads the same four labels whichever Resource Type is picked. */
const SCALE_LABELS = ['Resource Type', 'Kind', 'Name', 'Replicas']

const SHEET_ROWS_DEFAULT = [
  ...CONNECTION_ROWS,
  ...SCALE_ROWS_DEFAULT,
  ...ADVANCED_ROWS,
  ...FAILURE_ROWS,
]
const SHEET_ROWS_CUSTOM = [
  ...CONNECTION_ROWS,
  ...SCALE_ROWS_CUSTOM,
  ...ADVANCED_ROWS,
  ...FAILURE_ROWS,
]

const SHEET_LABELS = [
  'K8s Session',
  'Timeout',
  ...SCALE_LABELS,
  'Namespace',
  'Impersonate user',
  'Impersonate groups',
  'On error',
]

/** K8SREAD-12: a row that SELECTS A MODE resolves while the sheet is authored, so
 *  it drops the toggle. Every other row keeps it, the enum Kind included. */
const MODE_ROWS = ['resource_type', 'on_error']

interface ResourceTypeCase {
  state: 'Default' | 'Custom'
  rows: string[]
  required: string[]
  expressions: string[]
}

const RESOURCE_TYPE_CASES: ResourceTypeCase[] = [
  {
    state: 'Default',
    rows: SHEET_ROWS_DEFAULT,
    required: ['session', 'kind', 'name', 'replicas'],
    expressions: SHEET_ROWS_DEFAULT.filter((row) => !MODE_ROWS.includes(row)),
  },
  {
    state: 'Custom',
    rows: SHEET_ROWS_CUSTOM,
    required: ['session', 'kind_custom', 'name', 'replicas'],
    expressions: SHEET_ROWS_CUSTOM.filter((row) => !MODE_ROWS.includes(row)),
  },
]

const SCALABLE_KINDS = ['Deployment', 'ReplicaSet', 'ReplicationController', 'StatefulSet']

/** K8SWRITE-6: the sheet carries no current-count precondition and no wait. */
const ABSENT_ROWS = [
  'check_current_count',
  'current_replicas',
  'previous_replicas',
  'wait_until_ready',
  'wait_for_replicas',
  'scale_timeout',
]

const ROW_INFO: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  resource_type:
    'Default offers the kinds that can be scaled. Custom takes any other kind as plain text, including custom resources.',
  kind: 'The kind to scale. Only kinds the cluster serves a scale endpoint for can be scaled.',
  kind_custom:
    'The kind exactly as the cluster names it. A kind with no scale endpoint is refused before anything is written.',
  name: "The object's name.",
  replicas: 'How many replicas to run. 0 is allowed and scales the object down to nothing.',
  namespace:
    'Leave empty to use the namespace the session carries. Otherwise, the namespace the object is in.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUTS_FAIL = ['summary', 'success']
const OUTPUTS_RECORD = ['summary', 'success', 'error', 'reason']

const OUTPUT_LABELS: Record<string, string> = {
  summary: 'Summary',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const OUTPUT_TYPES: Record<string, string> = {
  summary: 'table',
  success: 'boolean',
  error: 'string',
  reason: 'string',
}

const OUTPUT_INFO: Record<string, string> = {
  summary:
    'One row per object: the resource, what happened to it, and the replica count before and after.',
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

/** The preview a string row shows while it holds nothing. */

async function openScaleConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-scale' },
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
async function openScaleConfigExpanded(page: Page): Promise<Locator> {
  const modal = await openScaleConfig(page)
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

/** Every visible input row id on the sheet, in DOM order. */
async function sheetRowIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

/** Every visible input row label, in DOM order, without the required marker. */
async function sheetRowLabels(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="param-row-"] td:nth-child(2)')
    .evaluateAll((cells) =>
      cells.map((cell) => (cell.textContent ?? '').replace(/\*\s*required$/, '').trim()),
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

test.describe('V-PLUGIN-K8S-08: K8s Scale config sheet', () => {
  test('SC-a: four groups in order; Advanced and Failure Handling open collapsed and expand on click', async ({
    page,
  }) => {
    const modal = await openScaleConfig(page)

    await expect(modal.getByRole('heading', { name: 'K8s Scale - Edit Config' })).toBeVisible()

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // K8SREAD-10: the sheet opens on the rows an author has to fill in.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Scale')).toHaveAttribute('aria-expanded', 'true')
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

    // No read-block verb group ever appears on this sheet.
    for (const foreign of ['Resource', 'Events', 'Logs', 'Measurement', 'Rollout']) {
      await expect(modal.locator(`[data-testid="group-header-${foreign}"]`), foreign).toHaveCount(0)
    }

    await expectOnlyRequiredFlags(modal)
  })

  test('SC-b: the Scale group holds exactly four rows in both Resource Type states', async ({
    page,
  }) => {
    const modal = await openScaleConfigExpanded(page)

    expect(await groupRowIds(modal, 'Connection')).toEqual(CONNECTION_ROWS)
    expect(await groupRowIds(modal, 'Scale')).toEqual(SCALE_ROWS_DEFAULT)
    expect(await groupRowLabels(modal, 'Scale')).toEqual(SCALE_LABELS)
    expect(await groupRowIds(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    expect(await groupRowIds(modal, 'Failure Handling')).toEqual(FAILURE_ROWS)
    expect(await sheetRowIds(modal)).toEqual(SHEET_ROWS_DEFAULT)
    expect(await sheetRowLabels(modal)).toEqual(SHEET_LABELS)

    // FIELD-2: Timeout shows its default in gray, not as a typed value.
    await expectGrayDefault(modal, 'timeout', '30')

    await pickEnum(page, modal, 'resource_type', 'Custom')

    expect(await groupRowIds(modal, 'Scale')).toEqual(SCALE_ROWS_CUSTOM)
    expect(await groupRowLabels(modal, 'Scale')).toEqual(SCALE_LABELS)
    expect(await sheetRowIds(modal)).toEqual(SHEET_ROWS_CUSTOM)
    expect(await sheetRowLabels(modal)).toEqual(SHEET_LABELS)

    await pickEnum(page, modal, 'resource_type', 'Default')
    expect(await groupRowIds(modal, 'Scale')).toEqual(SCALE_ROWS_DEFAULT)
  })

  test('SC-c: Resource Type swaps the Kind control and changes nothing else', async ({ page }) => {
    const modal = await openScaleConfigExpanded(page)

    // Default: Kind is a plain Radix select, not the grouped searchable picker.
    const kind = paramRow(modal, 'kind')
    await expect(kind.getByRole('combobox')).toHaveCount(1)
    await expect(kind.getByRole('combobox')).toHaveText('Deployment')
    await expect(modal.locator('[data-testid="enum-picker-trigger-kind"]')).toHaveCount(0)
    // FIELD-1: a choice list has no expand.
    await expect(modal.locator('[data-testid="param-expand-kind"]')).toHaveCount(0)
    await expect(kind.locator('[data-testid="expression-toggle"]')).toHaveCount(1)
    await expect(kind.locator('td:nth-child(3)')).toHaveText(/string/i)

    const outputsBefore = await outputRowIds(modal)

    await pickEnum(page, modal, 'resource_type', 'Custom')

    // Custom: the same label over a plain string field, still with its toggle.
    await expect(paramRow(modal, 'kind')).toHaveCount(0)
    const custom = paramRow(modal, 'kind_custom')
    await expect(custom).toHaveCount(1)
    await expect(custom.getByRole('combobox')).toHaveCount(0)
    await expect(custom.locator('svg.lucide-chevron-down')).toHaveCount(0)
    await expect(custom.locator('[data-slot="input-group"] input')).toHaveCount(1)
    await expect(custom.locator('[data-testid="param-expand-kind_custom"]')).toHaveCount(1)
    await expect(custom.locator('[data-testid="expression-toggle"]')).toHaveCount(1)
    await expect(custom.locator('td:nth-child(3)')).toHaveText(/string/i)

    // Nothing else on the sheet moved.
    expect(await groupRowIds(modal, 'Connection')).toEqual(CONNECTION_ROWS)
    expect(await groupRowIds(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    expect(await groupRowIds(modal, 'Failure Handling')).toEqual(FAILURE_ROWS)
    const groupNames = await modal
      .locator('[data-testid^="group-header-"]')
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
      )
    expect(groupNames).toEqual(GROUP_ORDER)
    expect(await outputRowIds(modal)).toEqual(outputsBefore)
    await expectOnlyRequiredFlags(modal)
  })

  test('SC-d: every enum offers its own options in order, first option first', async ({ page }) => {
    const modal = await openScaleConfigExpanded(page)

    expect(await readEnumOptions(page, modal, 'resource_type')).toEqual(['Default', 'Custom'])
    await expect(paramRow(modal, 'resource_type').getByRole('combobox')).toHaveText('Default')

    expect(await readEnumOptions(page, modal, 'kind')).toEqual(SCALABLE_KINDS)
    await expect(paramRow(modal, 'kind').getByRole('combobox')).toHaveText(SCALABLE_KINDS[0])

    expect(await readEnumOptions(page, modal, 'on_error')).toEqual([
      'Fail the block',
      'Record and continue',
    ])
    await expect(paramRow(modal, 'on_error').getByRole('combobox')).toHaveText('Fail the block')

    // The Kind list is exactly the four scalable kinds and nothing else.
    await pickEnum(page, modal, 'kind', 'StatefulSet')
    expect(await readEnumOptions(page, modal, 'kind')).toEqual(SCALABLE_KINDS)
  })

  test('SC-e: both Kind rows keep their value across a Resource Type round trip', async ({
    page,
  }) => {
    const modal = await openScaleConfigExpanded(page)

    await pickEnum(page, modal, 'kind', 'StatefulSet')

    // Custom hides the enum, and the string row starts empty: no value bleeds across.
    await pickEnum(page, modal, 'resource_type', 'Custom')
    await expect(paramRow(modal, 'kind')).toHaveCount(0)
    await expect(paramRow(modal, 'kind_custom').locator('[data-slot="input-group"] input')).toHaveValue('')

    await paramRow(modal, 'kind_custom').scrollIntoViewIfNeeded()
    await setStringParam(modal, page, 'kind_custom', 'ClusterWidget')
    await expectStringParamPreview(modal, 'kind_custom', 'ClusterWidget')

    // Default hides the string row and gives the enum back with its choice intact.
    await pickEnum(page, modal, 'resource_type', 'Default')
    await expect(paramRow(modal, 'kind_custom')).toHaveCount(0)
    await expect(paramRow(modal, 'kind').getByRole('combobox')).toHaveText('StatefulSet')

    await pickEnum(page, modal, 'resource_type', 'Custom')
    await expectStringParamPreview(modal, 'kind_custom', 'ClusterWidget')
  })

  test('SC-f: required markers, an info badge on every row, and the expression-toggle rule', async ({
    page,
  }) => {
    const modal = await openScaleConfigExpanded(page)

    for (const sheetCase of RESOURCE_TYPE_CASES) {
      await test.step(`Resource Type ${sheetCase.state}`, async () => {
        await pickEnum(page, modal, 'resource_type', sheetCase.state)
        expect(await sheetRowIds(modal), sheetCase.state).toEqual(sheetCase.rows)

        const starred: string[] = []
        const badgeless: string[] = []
        const toggled: string[] = []
        for (const name of sheetCase.rows) {
          const row = paramRow(modal, name)
          await expect(row, name).toHaveCount(1)
          if ((await requiredStar(modal, name).count()) > 0) starred.push(name)
          if ((await row.locator('td').first().locator('svg').count()) === 0) badgeless.push(name)
          if ((await row.locator('[data-testid="expression-toggle"]').count()) > 0) {
            toggled.push(name)
          }
        }

        expect(starred, `${sheetCase.state}: rows carrying the required marker`).toEqual(
          sheetCase.required,
        )
        expect(badgeless, `${sheetCase.state}: rows missing the (i) info badge`).toEqual([])
        // Only Resource Type and On error select a mode, so only they drop the toggle.
        expect(toggled, `${sheetCase.state}: rows offering the expression toggle`).toEqual(
          sheetCase.expressions,
        )
        for (const name of MODE_ROWS) {
          await expect(
            paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
            name,
          ).toHaveCount(0)
        }
      })
    }
  })

  test('SC-g: every input and output row carries its exact info badge wording', async ({
    page,
  }) => {
    const modal = await openScaleConfigExpanded(page)

    for (const name of SHEET_ROWS_DEFAULT) {
      await expectBadge(page, modal, paramRow(modal, name), name, ROW_INFO[name])
    }

    await pickEnum(page, modal, 'resource_type', 'Custom')
    await expectBadge(page, modal, paramRow(modal, 'kind_custom'), 'kind_custom', ROW_INFO['kind_custom'])
    await pickEnum(page, modal, 'resource_type', 'Default')

    for (const name of OUTPUTS_FAIL) {
      await expectBadge(page, modal, outputRow(modal, name), name, OUTPUT_INFO[name])
    }

    await pickEnum(page, modal, 'on_error', 'Record and continue')
    for (const name of ['error', 'reason']) {
      await expectBadge(page, modal, outputRow(modal, name), name, OUTPUT_INFO[name])
    }
  })

  test('SC-h: no precondition pair, no wait row and no second timeout', async ({ page }) => {
    const modal = await openScaleConfigExpanded(page)

    for (const state of ['Default', 'Custom'] as const) {
      await test.step(`Resource Type ${state}`, async () => {
        await pickEnum(page, modal, 'resource_type', state)

        // K8SWRITE-6: Scale carries neither a precondition nor a wait.
        for (const name of ABSENT_ROWS) {
          await expect(paramRow(modal, name), `${state}: ${name}`).toHaveCount(0)
        }
        // The four labels of the verb group are the whole of it.
        expect(await groupRowLabels(modal, 'Scale'), state).toEqual(SCALE_LABELS)
        // Connection's Timeout is the only timeout on the sheet.
        await expect(
          modal.locator('[data-testid^="param-row-"][data-testid*="timeout"]'),
          state,
        ).toHaveCount(1)
        expect(await groupRowIds(modal, 'Connection'), state).toEqual(CONNECTION_ROWS)
        // No Boolean survives on this sheet, so no tick can gate anything.
        await expect(
          modal.locator('[data-testid^="param-row-"] [role="checkbox"]'),
          state,
        ).toHaveCount(0)
      })
    }
  })

  test('SC-i: two outputs as the sheet opens, four under Record and continue', async ({ page }) => {
    const modal = await openScaleConfig(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUTS_FAIL.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUTS_FAIL)

    for (const name of OUTPUTS_FAIL) {
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

    // K8SWRITE-8: Error and Reason arrive only under Record and continue.
    await expandGroup(modal, 'Failure Handling')
    await pickEnum(page, modal, 'on_error', 'Record and continue')

    await expect(outputs).toHaveCount(OUTPUTS_RECORD.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUTS_RECORD)
    for (const name of ['error', 'reason']) {
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(
        OUTPUT_LABELS[name],
      )
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(
        new RegExp(OUTPUT_TYPES[name], 'i'),
      )
    }

    await pickEnum(page, modal, 'on_error', 'Fail the block')
    await expect(outputs).toHaveCount(OUTPUTS_FAIL.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUTS_FAIL)

    // Scale offers no Names, Count or Result output in either mode.
    for (const name of ['names', 'count', 'result', 'replicas', 'observed_replicas']) {
      await expect(outputRow(modal, name), name).toHaveCount(0)
    }
  })
})
