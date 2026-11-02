/**
 * V-PLUGIN-K8S-12: K8s Copy config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop; CP-k seeds its own Test via
 * POST /tests and afterAll deletes it.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SEXEC-4, K8SEXEC-5, K8SEXEC-6, K8SEXEC-7, K8SEXEC-8,
 *                   K8SEXEC-9, K8SEXEC-10, K8SREAD-10, K8SREAD-12, K8SREAD-14,
 *                   K8SWRITE-8, PING-17
 *
 * Criterion ids use the CP- prefix, following the per-file letter convention
 * v-plugin-k8s-01.spec.ts established.
 *
 * Pass Criteria:
 *   CP-a  four group cards in order Connection / Copy / Advanced / Failure
 *         Handling; Advanced and Failure Handling open COLLAPSED, rendering
 *         neither their rows nor their footer, and expand on click; every
 *         expanded card carries its exact footer note; the Secrets collapsible
 *         opens closed
 *   CP-b  every group holds its own rows with their exact labels, in schema
 *         order, in BOTH directions, and Timeout shows its gray default 60;
 *         under From Pod Advanced holds Namespace, Impersonate user,
 *         Impersonate groups, Max size (MiB) (Integer, gray default 256) and
 *         Max files (Integer, gray default 10000); under To Pod the first three
 *   CP-c  Direction offers From Pod and To Pod, opens on From Pod, and exactly
 *         one Source Path row and one Target Path row render in either state
 *   CP-d  the two path labels never move when Direction flips; only the info
 *         badge changes, and all four wordings are exact
 *   CP-e  a typed path survives a Direction round trip, because both
 *         descriptors of a label share one field
 *   CP-f  No Preserve is a tick that opens unticked and takes a tick
 *   CP-g  K8s Session, Direction, Pod, Container, Source Path and Target Path
 *         are the only rows carrying the required *, Container included, so
 *         the two limit rows carry none, and every row leads with the (i) info
 *         badge
 *   CP-h  only Direction and On error drop the expression toggle, so the
 *         Boolean No Preserve and both limit rows keep their own
 *   CP-i  the info badge of every input row and every output row carries its
 *         exact wording, the two limit rows included
 *   CP-j  Summary and Success are the whole output list, Summary typed table
 *         and neither marked Secret; there is no file count and no path list;
 *         Error and Reason join them only under Record and continue and leave
 *         again on the way back
 *   CP-k  on an otherwise complete block, Max size (MiB) -1 reads "Max size
 *         (MiB) must be at least 0" and Max files -1 reads "Max files must be
 *         at least 0" under the field: the typed value is kept, the field is
 *         marked invalid, no other row is flagged and Save is blocked under the
 *         settings note; 0 clears the message and opens Save again
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openBlockSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { expectStringParamPreview, setStringParam } from '../../helpers/param-config'
import { expectGrayDefault } from '../../helpers/default-rule'
import {
  expectOnlyRequiredFlags,
  numberInput,
  rowAlerts,
  rowError,
  saveButton,
  settingsNote,
} from '../../helpers/config-sheet'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { chainEdges, k8sConnectNode, k8sCopyNode, stackNodes } from '../../helpers/k8s-nodes'

const GROUP_ORDER = ['Connection', 'Copy', 'Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Copy': 'What to copy, and which way',
  'Advanced':
    'Namespace and identity in place of what the session provides, and size limits for copies from the pod',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const CONNECTION_ROWS = ['session', 'timeout']
/** K8SEXEC-5: the same six ids render whichever way the file is moving. */
const COPY_ROWS = ['direction', 'pod', 'container', 'source_path', 'target_path', 'no_preserve']
const IDENTITY_ROWS = ['namespace', 'impersonate_user', 'impersonate_groups']
/** K8SEXEC-10: the size limits bound only what a copy from the pod writes. */
const LIMIT_ROWS = ['max_size_mib', 'max_files']
const ADVANCED_ROWS: Record<string, string[]> = {
  'From Pod': [...IDENTITY_ROWS, ...LIMIT_ROWS],
  'To Pod': IDENTITY_ROWS,
}
const FAILURE_ROWS = ['on_error']

const sheetRows = (direction: string): string[] => [
  ...CONNECTION_ROWS,
  ...COPY_ROWS,
  ...ADVANCED_ROWS[direction],
  ...FAILURE_ROWS,
]

const groupRows = (direction: string): Record<string, string[]> => ({
  'Connection': CONNECTION_ROWS,
  'Copy': COPY_ROWS,
  'Advanced': ADVANCED_ROWS[direction],
  'Failure Handling': FAILURE_ROWS,
})

/** The sheet opens on From Pod. */
const DEFAULT_DIRECTION = 'From Pod'

const LIMIT_PLACEHOLDERS: Record<string, string> = {
  max_size_mib: '256',
  max_files: '10000',
}

const LIMIT_MESSAGES: Record<string, string> = {
  max_size_mib: 'Max size (MiB) must be at least 0',
  max_files: 'Max files must be at least 0',
}

const SETTINGS_NOTE = 'Save is disabled: the settings have errors'

const ROW_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  direction: 'Direction',
  pod: 'Pod',
  container: 'Container',
  source_path: 'Source Path',
  target_path: 'Target Path',
  no_preserve: 'No Preserve',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  max_size_mib: 'Max size (MiB)',
  max_files: 'Max files',
  on_error: 'On error',
}

/** K8SEXEC-9: Container is required here as it is on every exec-channel block. */
const REQUIRED_ROWS = ['session', 'direction', 'pod', 'container', 'source_path', 'target_path']

/** K8SREAD-12: the two rows that select a mode drop the toggle; No Preserve keeps its own. */
const MODE_ROWS = ['direction', 'on_error']

/** Rows this sheet never offers, plus the rows other K8s blocks own. */
const ABSENT_ROWS = [
  'stdin',
  'command',
  'interpreter',
  'script',
  'working_dir',
  'workdir',
  'retries',
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
  'Script',
]

const DIRECTION_OPTIONS = ['From Pod', 'To Pod']
const ON_ERROR_OPTIONS = ['Fail the block', 'Record and continue']

const WAVE_SIDE = 'an artifact path, or an absolute or relative path where the block runs'

/** K8SEXEC-5: one label, two descriptors, so each badge names the right side. */
const PATH_INFO: Record<string, Record<string, string>> = {
  'From Pod': {
    source_path: 'The file or directory inside the pod to copy.',
    target_path: `Where to put it on the WAVE side: ${WAVE_SIDE}.`,
  },
  'To Pod': {
    source_path: `The file or directory on the WAVE side to copy: ${WAVE_SIDE}.`,
    target_path: 'Where to put it inside the pod.',
  },
}

const ROW_INFO: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  direction:
    'Which way the file moves: out of the pod onto the WAVE side, or from WAVE into the pod.',
  pod: 'The pod to copy from or to.',
  container: 'Which container in the pod to use. Name it even when the pod has only one.',
  no_preserve:
    "Do not carry the file's permissions and ownership across. kubectl preserves them by default.",
  namespace:
    'The namespace the pod is in. Leave empty to use the namespace the session carries.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  max_size_mib:
    'Largest total a copy from the pod may write, in MiB. The copy stops the moment it goes over and removes what it wrote. 0 means no limit.',
  max_files:
    'Most files a copy from the pod may write. The copy stops the moment it goes over and removes what it wrote. 0 means no limit.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_ORDER = ['summary', 'success']
const OUTPUT_ORDER_RECORD = [...OUTPUT_ORDER, 'error', 'reason']

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
  summary: 'One row per file: where it came from, where it landed, and its size.',
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

async function openCopyConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-copy' },
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

const CONNECT_NODE_ID = '0a79ab60-55fd-467a-9ea5-8bf041215d47'
const COPY_NODE_ID = '0dd22f61-3964-431f-b468-31d1c6c0baf6'
const SESSION_VAR = 'k8s_session'

const created: string[] = []

/** One Connect and one From Pod Copy with every required row filled. */
function completeCopyFixture(): Record<string, unknown> {
  return {
    name: 'V-PLUGIN-K8S-12 complete copy',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: stackNodes([
        k8sConnectNode({
          id: CONNECT_NODE_ID,
          values: { api_url: 'https://10.0.0.1:6443' },
          outputBindings: { session: SESSION_VAR },
        }),
        k8sCopyNode({
          id: COPY_NODE_ID,
          expressionFields: ['session'],
          values: {
            session: SESSION_VAR,
            direction: 'from_pod',
            pod: 'payments-api-0',
            container: 'app',
            source_path: '/var/log/app.log',
            target_path: 'app.log',
          },
        }),
      ]),
      edges: chainEdges([CONNECT_NODE_ID, COPY_NODE_ID]),
    },
    variables: {
      [SESSION_VAR]: { value: '', type: 'string', scope: 'test', secret: true },
    },
    metadata: {},
  }
}

/** Open the seeded Copy's sheet with Advanced unfolded; Save opens only on a change. */
async function openCompleteCopyConfig(page: Page): Promise<Locator> {
  created.push(await importValidateAndNavigate(page, completeCopyFixture()))
  const node = page.locator(`[data-testid="workflow-node-${COPY_NODE_ID}"]`)
  await expect(node).toBeVisible({ timeout: 20_000 })
  await node.hover()
  await openBlockSheet(page, COPY_NODE_ID)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  await expandGroup(modal, 'Advanced')
  return modal
}

/** Open the sheet with Advanced and Failure Handling already unfolded. */
async function openCopyConfigExpanded(page: Page): Promise<Locator> {
  const modal = await openCopyConfig(page)
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

const checkbox = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('button[role="checkbox"]')

/** Expand a collapsible group card. Idempotent. */
async function expandGroup(modal: Locator, group: string) {
  const header = groupHeader(modal, group)
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

async function setCheckbox(modal: Locator, name: string, on: boolean) {
  const box = checkbox(modal, name)
  await box.scrollIntoViewIfNeeded()
  await expect(box).toBeVisible()
  const want = on ? 'checked' : 'unchecked'
  if ((await box.getAttribute('data-state')) !== want) await box.click()
  await expect(box).toHaveAttribute('data-state', want)
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

test.describe('V-PLUGIN-K8S-12: K8s Copy config sheet', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) {
      const response = await request.delete(`${BACKEND_URL}/tests/${testId}`)
      expect([204, 404], `teardown DELETE /tests/${testId}`).toContain(response.status())
    }
  })

  test('CP-a: four groups in order; Advanced and Failure Handling open collapsed and expand on click', async ({
    page,
  }) => {
    const modal = await openCopyConfig(page)

    await expect(modal.getByRole('heading', { name: 'K8s Copy - Edit Config' })).toBeVisible()

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // K8SREAD-10: the sheet opens on the rows an author has to fill in.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Copy')).toHaveAttribute('aria-expanded', 'true')
    for (const group of COLLAPSED_GROUPS) {
      await expect(groupHeader(modal, group)).toHaveAttribute('aria-expanded', 'false')
      // A folded card renders neither its rows nor its footer.
      expect(await groupRowIds(modal, group), group).toEqual([])
      await expect(groupFooter(modal, group), group).toHaveCount(0)
    }
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)
    for (const name of [...ADVANCED_ROWS[DEFAULT_DIRECTION], ...FAILURE_ROWS]) {
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

  test('CP-b: every group holds its own rows and labels in schema order in both directions', async ({
    page,
  }) => {
    const modal = await openCopyConfigExpanded(page)

    for (const direction of DIRECTION_OPTIONS) {
      await test.step(`Direction ${direction}`, async () => {
        await pickEnum(page, modal, 'direction', direction)

        for (const [group, rows] of Object.entries(groupRows(direction))) {
          expect(await groupRowIds(modal, group), `${direction} ${group}`).toEqual(rows)
          expect(await groupRowLabels(modal, group), `${direction} ${group}`).toEqual(
            rows.map((name) => ROW_LABELS[name]),
          )
        }
        expect(await sheetRowIds(modal), direction).toEqual(sheetRows(direction))
        await expect(modal.locator('[data-testid^="param-row-"]'), direction).toHaveCount(
          sheetRows(direction).length,
        )

        for (const name of ABSENT_ROWS) {
          await expect(paramRow(modal, name), `${direction} ${name}`).toHaveCount(0)
        }
      })
    }

    // K8SEXEC-10: the limits show only under From Pod, typed Integer, defaults in gray (FIELD-2).
    await pickEnum(page, modal, 'direction', 'To Pod')
    for (const name of LIMIT_ROWS) {
      await expect(paramRow(modal, name), `To Pod ${name}`).toHaveCount(0)
    }
    await pickEnum(page, modal, 'direction', 'From Pod')
    for (const [name, placeholder] of Object.entries(LIMIT_PLACEHOLDERS)) {
      await expect(paramRow(modal, name).locator('td:nth-child(3)'), name).toHaveText('Integer', {
        useInnerText: true,
      })
      await expectGrayDefault(modal, name, placeholder)
    }

    // The exec-channel blocks wait longer than the read family does.
    await expectGrayDefault(modal, 'timeout', '60')

    expect(await readEnumOptions(page, modal, 'on_error')).toEqual(ON_ERROR_OPTIONS)
    await expect(paramRow(modal, 'on_error').getByRole('combobox')).toHaveText(ON_ERROR_OPTIONS[0])
  })

  test('CP-c: Direction offers From Pod and To Pod and one path row of each kind renders at a time', async ({
    page,
  }) => {
    const modal = await openCopyConfigExpanded(page)

    expect(await readEnumOptions(page, modal, 'direction')).toEqual(DIRECTION_OPTIONS)
    await expect(paramRow(modal, 'direction').getByRole('combobox')).toHaveText(
      DIRECTION_OPTIONS[0],
    )

    for (const direction of [...DIRECTION_OPTIONS, DIRECTION_OPTIONS[0]]) {
      await pickEnum(page, modal, 'direction', direction)
      // Two descriptors share one field, so exactly one of each is ever rendered.
      await expect(paramRow(modal, 'source_path'), direction).toHaveCount(1)
      await expect(paramRow(modal, 'target_path'), direction).toHaveCount(1)
      await expect(paramRow(modal, 'source_path').locator('td:nth-child(3)')).toHaveText(/string/i)
      await expect(paramRow(modal, 'target_path').locator('td:nth-child(3)')).toHaveText(/string/i)
    }
  })

  test('CP-d: the path labels never move; only the badge wording follows the direction', async ({
    page,
  }) => {
    const modal = await openCopyConfigExpanded(page)

    for (const direction of DIRECTION_OPTIONS) {
      await test.step(`Direction ${direction}`, async () => {
        await pickEnum(page, modal, 'direction', direction)

        expect(await groupRowLabels(modal, 'Copy'), direction).toEqual([
          'Direction',
          'Pod',
          'Container',
          'Source Path',
          'Target Path',
          'No Preserve',
        ])

        for (const name of ['source_path', 'target_path']) {
          await expect(paramRow(modal, name), `${direction} ${name}`).toHaveCount(1)
          await expectBadge(
            page,
            modal,
            paramRow(modal, name),
            `${direction} ${name}`,
            PATH_INFO[direction][name],
          )
        }
      })
    }
  })

  test('CP-e: a typed path survives a Direction round trip', async ({ page }) => {
    const modal = await openCopyConfigExpanded(page)

    await setStringParam(modal, page, 'source_path', '/var/log/app.log')
    await expectStringParamPreview(modal, 'source_path', '/var/log/app.log')

    // Both descriptors share one field, so flipping the direction keeps the draft.
    await pickEnum(page, modal, 'direction', 'To Pod')
    await expectStringParamPreview(modal, 'source_path', '/var/log/app.log')

    await setStringParam(modal, page, 'target_path', '/tmp/app.log')
    await expectStringParamPreview(modal, 'target_path', '/tmp/app.log')

    await pickEnum(page, modal, 'direction', 'From Pod')
    await expectStringParamPreview(modal, 'source_path', '/var/log/app.log')
    await expectStringParamPreview(modal, 'target_path', '/tmp/app.log')

    await expectOnlyRequiredFlags(modal)
  })

  test('CP-f: No Preserve opens unticked and takes a tick', async ({ page }) => {
    const modal = await openCopyConfigExpanded(page)

    // K8SEXEC-7: kubectl preserves by default, so the tick is the opt-out.
    await expect(checkbox(modal, 'no_preserve')).toHaveAttribute('data-state', 'unchecked')
    await expect(requiredStar(modal, 'no_preserve')).toHaveCount(0)
    await expect(paramRow(modal, 'no_preserve').locator('td:nth-child(3)')).toHaveText(/boolean/i)

    await setCheckbox(modal, 'no_preserve', true)
    await setCheckbox(modal, 'no_preserve', false)
  })

  test('CP-g: six required rows, Container included, and every row leads with the info badge', async ({
    page,
  }) => {
    const modal = await openCopyConfigExpanded(page)

    for (const direction of DIRECTION_OPTIONS) {
      await test.step(`Direction ${direction}`, async () => {
        await pickEnum(page, modal, 'direction', direction)

        const rows = await sheetRowIds(modal)
        expect(rows, direction).toEqual(sheetRows(direction))

        const starred: string[] = []
        const badgeless: string[] = []
        for (const name of rows) {
          // The positive count keeps a renamed row from passing the sweep vacuously.
          await expect(paramRow(modal, name), `${direction} ${name}`).toHaveCount(1)
          if ((await requiredStar(modal, name).count()) > 0) starred.push(name)
          if ((await paramRow(modal, name).locator('td').first().locator('svg').count()) === 0) {
            badgeless.push(name)
          }
        }

        // K8SEXEC-9: WAVE never picks a container for the author.
        expect(starred, `${direction}: rows carrying the required marker`).toEqual(REQUIRED_ROWS)
        await expect(requiredStar(modal, 'container'), direction).toHaveCount(1)
        expect(badgeless, `${direction}: rows missing the (i) info badge`).toEqual([])
      })
    }

    await pickEnum(page, modal, 'direction', 'From Pod')
    for (const name of LIMIT_ROWS) {
      await expect(paramRow(modal, name), name).toHaveCount(1)
      await expect(requiredStar(modal, name), `${name} carries no required mark`).toHaveCount(0)
    }

    // FIELDERR-3: a fresh sheet flags its empty required rows at once, and nothing else.
    await expectOnlyRequiredFlags(modal)
  })

  test('CP-h: only Direction and On error drop the expression toggle, so No Preserve and the limits keep their own', async ({
    page,
  }) => {
    const modal = await openCopyConfigExpanded(page)

    for (const direction of DIRECTION_OPTIONS) {
      await test.step(`Direction ${direction}`, async () => {
        await pickEnum(page, modal, 'direction', direction)

        const rows = await sheetRowIds(modal)
        const toggled: string[] = []
        for (const name of rows) {
          await expect(paramRow(modal, name), `${direction} ${name}`).toHaveCount(1)
          if (
            (await paramRow(modal, name).locator('[data-testid="expression-toggle"]').count()) > 0
          ) {
            toggled.push(name)
          }
        }

        expect(toggled, `${direction}: rows offering the expression toggle`).toEqual(
          rows.filter((name) => !MODE_ROWS.includes(name)),
        )
      })
    }

    await pickEnum(page, modal, 'direction', 'From Pod')
    for (const name of ['no_preserve', ...LIMIT_ROWS]) {
      await expect(
        paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
        name,
      ).toHaveCount(1)
    }
    for (const name of MODE_ROWS) {
      await expect(
        paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
        name,
      ).toHaveCount(0)
    }
  })

  test('CP-i: every input and output row carries its exact info badge wording', async ({
    page,
  }) => {
    const modal = await openCopyConfigExpanded(page)

    for (const name of sheetRows(DEFAULT_DIRECTION)) {
      if (name === 'source_path' || name === 'target_path') continue
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

  test('CP-j: Summary and Success are the whole output list, with Error and Reason under Record and continue', async ({
    page,
  }) => {
    const modal = await openCopyConfigExpanded(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUT_ORDER.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUT_ORDER)

    // K8SEXEC-6: Summary carries the per-file detail, so nothing counts files
    // or lists paths beside it, and the copy runs off the exec channel without
    // a command's stdout, stderr or exit code.
    for (const name of ['count', 'files', 'paths', 'stdout', 'stderr', 'exit_code']) {
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

  test('CP-k: a limit below 0 is flagged on its field, kept as typed, and blocks Save', async ({
    page,
  }) => {
    const modal = await openCompleteCopyConfig(page)
    await expect(rowAlerts(modal), 'the complete block flags nothing').toHaveCount(0)

    // PING-17: the typed value is kept, never clamped, and the bound alone holds Save shut.
    for (const [name, message] of Object.entries(LIMIT_MESSAGES)) {
      await test.step(name, async () => {
        // FIELD-2: the first key typed over the gray default replaces it.
        await numberInput(modal, name).click()
        await page.keyboard.type('-1')
        await expect(rowError(modal, name)).toHaveText(message)
        await expect(numberInput(modal, name)).toHaveAttribute('aria-invalid', 'true')
        await expect(numberInput(modal, name), 'the typed value is kept').toHaveValue('-1')
        await expect(rowAlerts(modal), 'no other row is flagged').toHaveCount(1)
        await expect(settingsNote(modal)).toHaveText(SETTINGS_NOTE)
        await expect(saveButton(modal)).toBeDisabled()

        await numberInput(modal, name).fill('0')
        await expect(rowAlerts(modal), '0 means no limit and is inside the bound').toHaveCount(0)
        await expect(settingsNote(modal)).toHaveCount(0)
        await expect(saveButton(modal)).toBeEnabled()
      })
    }
  })
})
