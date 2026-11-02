/**
 * V-PLUGIN-HELM-01: The six Helm config sheets and the Helm palette section
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-3.5.3.1, REQ-3.5.3.5, REQ-5.1.1
 * Design Decisions: HELM-2, HELM-3, HELM-4, HELM-5, HELM-6, HELM-7, HELM-8,
 *                   HELM-9, HELM-10, HELM-11
 *
 * Criterion ids use the HM- prefix, following the per-file letter convention
 * v-plugin-k8s-01.spec.ts established.
 *
 * Three points where the shipped sheets differ from the wireframes, asserted
 * here as the shipped truth:
 *   1. Only a group holding a required row opens expanded, so Auth & TLS,
 *      Advanced, Failure Handling and the Secrets collapsible all open FOLDED
 *      on every Helm sheet. The wireframes draw Failure Handling open.
 *   2. Uninstall's Cascade reads Background / Foreground / Orphan with
 *      Background the default. The stored values stay lower case.
 *   3. Install if missing, Reuse Values, Reset Values and Logs decide what the
 *      rest of the sheet shows or writes, so they are fixed values with NO
 *      expression toggle, though the wireframes draw one on each.
 *
 * Pass Criteria:
 *   HM-a  per sheet: the group cards in order Connection / verb / Auth & TLS
 *         where the block has one / Advanced / Failure Handling; only Connection
 *         and the verb group open expanded, the folded cards render neither
 *         their rows nor their footer and expand on click; every expanded card
 *         carries its exact footer note; the Secrets collapsible opens closed;
 *         no other block's verb group appears; nothing on the sheet is in error
 *   HM-b  per sheet: every group holds its own rows in schema order with their
 *         exact labels; K8s Session, Release Name and Chart are the only rows
 *         carrying the required marker; no row any other Helm block owns leaks
 *         in and no wait or poll row exists in any state; Timeout shows its
 *         default in gray, nothing stored (FIELD-2); Output Format, On error
 *         and Cascade offer their options in order with their defaults; every
 *         boolean opens off except Verify Server Certificate; every row leads
 *         with the (i) badge and the Helm rows carry their exact wording; only
 *         the rows that decide what the sheet shows drop the expression toggle
 *   HM-c  per sheet: the outputs under Fail the block with their labels, types
 *         and exact badge wording; Error and Reason join only under Record and
 *         continue and leave again; Result's declared type follows Output Format
 *         (Table -> table, Map -> map, JSON / YAML -> string)
 *   HM-d  Upgrade: ticking Reset Values unticks Reuse Values and the other way
 *         round; both rows stay enabled and visible; both may be off
 *   HM-e  Upgrade: Create Namespace joins Advanced directly under Namespace only
 *         while Install if missing is on, and leaves again when it goes off
 *   HM-f  Test: the Logs output appears between Result and Success only while
 *         the Logs row is on
 *   HM-g  the palette Helm section holds exactly the six entries in order with a
 *         count badge of 6, sits between Kubernetes (still 12) and Data, paints
 *         every glyph indigo, and the footer handle reads New Function
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { expectGrayDefault } from '../../helpers/default-rule'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { dragPaletteItemToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { expectOnlyRequiredFlags } from '../../helpers/config-sheet'

// --- Shared furniture ------------------------------------------------------

const CONNECTION_ROWS = ['session', 'timeout']
const AUTH_ROWS = ['repo_username', 'repo_password', 'repo_ca_cert', 'repo_verify_ssl']
const ADVANCED_TAIL = ['namespace', 'helm_path', 'impersonate_user', 'impersonate_groups']

const CONNECTION_FOOTER_HELM = "K8s Session and helm's operation timeout"
const CONNECTION_FOOTER_REQUEST = 'K8s Session and request timeout'
const AUTH_FOOTER = 'Credentials and trust for the chart repository'
const ADVANCED_FOOTER = 'Session overrides and the helm executable'
const FAILURE_FOOTER =
  'Record and continue sets Success, Error and Reason instead of failing the block'

const ROW_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  release: 'Release Name',
  chart: 'Chart',
  version: 'Version',
  repo: 'Repository URL',
  values: 'Values',
  set: 'Set',
  output_format: 'Output Format',
  install: 'Install if missing',
  reuse_values: 'Reuse Values',
  reset_values: 'Reset Values',
  revision: 'Revision',
  keep_history: 'Keep History',
  ignore_not_found: 'Ignore Not Found',
  cascade: 'Cascade',
  logs: 'Logs',
  repo_username: 'Repository Username',
  repo_password: 'Repository Password',
  repo_ca_cert: 'Repository CA Certificate',
  repo_verify_ssl: 'Verify Server Certificate',
  namespace: 'Namespace',
  create_namespace: 'Create Namespace',
  helm_path: 'Helm Path',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  atomic: 'Atomic',
  cleanup_on_fail: 'Cleanup on Fail',
  on_error: 'On error',
}

/** Every row the Helm family owns, so a sheet can be checked for leakage. */
const ALL_HELM_ROWS = Object.keys(ROW_LABELS)

/** Rows that render a checkbox rather than a value field. */
const BOOLEAN_ROWS = new Set([
  'install',
  'reuse_values',
  'reset_values',
  'keep_history',
  'ignore_not_found',
  'logs',
  'repo_verify_ssl',
  'create_namespace',
  'atomic',
  'cleanup_on_fail',
])

/** The one boolean that ships on, so a repository is verified by default. */
const CHECKED_ROWS = new Set(['repo_verify_ssl'])

/**
 * A row whose value decides what the rest of the sheet shows or writes resolves
 * while the sheet is authored, so it drops the expression toggle. Install if
 * missing, Reuse Values, Reset Values and Logs are in here even though the
 * wireframes draw a toggle on each.
 */
const NO_EXPRESSION_ROWS = new Set([
  'output_format',
  'on_error',
  'install',
  'reuse_values',
  'reset_values',
  'cascade',
  'logs',
])

const OUTPUT_FORMAT_OPTIONS = ['Map', 'Table', 'JSON', 'YAML']
const ON_ERROR_OPTIONS = ['Fail the block', 'Record and continue']
const CASCADE_OPTIONS = ['Background', 'Foreground', 'Orphan']

/** HELM-6: Result is declared as whatever Output Format asks for. */
const RESULT_TYPE_FOR: Record<string, string> = {
  Table: 'table',
  Map: 'map',
  JSON: 'string',
  YAML: 'string',
}

const OUTPUT_LABELS: Record<string, string> = {
  result: 'Result',
  status: 'Status',
  logs: 'Logs',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const OUTPUT_TYPES: Record<string, string> = {
  status: 'string',
  logs: 'string',
  success: 'boolean',
  error: 'string',
  reason: 'string',
}

const SESSION_INFO =
  'The session from a K8s Connect block: server URL, credentials and default namespace'
const HELM_TIMEOUT_INFO = 'How long helm gets to finish the operation, in seconds'
const REQUEST_TIMEOUT_INFO = 'Request timeout in seconds'
const HELM_PATH_INFO =
  "The helm executable to run: a name looked up on the PATH where the block runs, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs 'helm' from the PATH"
const OUTPUT_FORMAT_INFO =
  'How Result comes back. Table is the printed summary, Map the parsed release document, JSON and YAML the same document as text.'

const RELEASE_RESULT_INFO =
  'The release in the shape Output Format asks for: the summary as a table, or the whole release document'
const TEST_RESULT_INFO =
  'One row per test hook: its name, kind, phase and when it started and completed. A chart with no tests gives an empty result.'
const STATUS_OUTPUT_INFO =
  'The release state helm reports, like deployed, failed or pending-upgrade'
const LOGS_OUTPUT_INFO = 'What the test pods printed, in the sections helm prints them in.'

/** Verb groups the other block families own; none may appear on a Helm sheet. */
const FOREIGN_GROUPS = [
  'Resource',
  'Events',
  'Logs',
  'Measurement',
  'Scale',
  'Rollout',
  'Command',
  'Script',
  'Copy',
  'Authentication',
]

// --- The six sheets --------------------------------------------------------

interface HelmSheet {
  /** Element type, palette item suffix and node label stem. */
  id: string
  label: string
  verb: string
  verbFooter: string
  connectionFooter: string
  /** Timeout's default, shown in gray while not set (FIELD-2). */
  timeout: string
  auth: boolean
  verbRows: string[]
  advancedRows: string[]
  failureRows: string[]
  /** OUTPUT VARIABLES under On error = Fail the block. */
  outputs: string[]
  required: string[]
  /** Rows whose wording is Helm's own, asserted verbatim. */
  badges: Record<string, string>
  /** Result's declared type in the default Table format, when the block has one. */
  resultInfo?: string
}

const SHEETS: HelmSheet[] = [
  {
    id: 'helm-install',
    label: 'Helm Install',
    verb: 'Install',
    verbFooter: 'Chart, release and values',
    connectionFooter: CONNECTION_FOOTER_HELM,
    timeout: '300',
    auth: true,
    verbRows: ['release', 'chart', 'version', 'repo', 'values', 'set', 'output_format'],
    // HELM-8: Create Namespace sits directly under Namespace.
    advancedRows: [
      'namespace',
      'create_namespace',
      'helm_path',
      'impersonate_user',
      'impersonate_groups',
    ],
    // HELM-3: helm's own repair sits above On error.
    failureRows: ['atomic', 'on_error'],
    outputs: ['result', 'status', 'success'],
    required: ['session', 'release', 'chart'],
    badges: {
      release:
        'The name to give the release. A name already in use in the namespace is an error.',
      create_namespace: 'Create the namespace first when it does not exist yet.',
      atomic:
        'Remove the release again when the install fails, so its name stays free. helm waits for the resources by its own definition of ready before it decides.',
    },
    resultInfo: RELEASE_RESULT_INFO,
  },
  {
    id: 'helm-upgrade',
    label: 'Helm Upgrade',
    verb: 'Upgrade',
    verbFooter: 'Chart, release and values',
    connectionFooter: CONNECTION_FOOTER_HELM,
    timeout: '300',
    auth: true,
    verbRows: [
      'release',
      'chart',
      'version',
      'repo',
      'values',
      'set',
      'install',
      'reuse_values',
      'reset_values',
      'output_format',
    ],
    // HELM-8: Create Namespace is absent until Install if missing goes on.
    advancedRows: ADVANCED_TAIL,
    failureRows: ['atomic', 'cleanup_on_fail', 'on_error'],
    outputs: ['result', 'status', 'success'],
    required: ['session', 'release', 'chart'],
    badges: {
      release: 'The release to upgrade.',
      install: 'Install the release when it does not exist yet, instead of failing.',
      reuse_values:
        "Start from the current release's values and apply Values and Set on top. Ticking this unticks Reset Values.",
      reset_values:
        "Start from the chart's own defaults and apply Values and Set on top. Ticking this unticks Reuse Values.",
      cleanup_on_fail:
        'Delete the resources this upgrade created when it fails, instead of leaving them behind.',
    },
    resultInfo: RELEASE_RESULT_INFO,
  },
  {
    id: 'helm-rollback',
    label: 'Helm Rollback',
    verb: 'Rollback',
    verbFooter: 'Release and target revision',
    connectionFooter: CONNECTION_FOOTER_HELM,
    timeout: '300',
    auth: false,
    verbRows: ['release', 'revision', 'output_format'],
    advancedRows: ADVANCED_TAIL,
    // helm rollback has no atomic flag, so Cleanup on Fail stands alone.
    failureRows: ['cleanup_on_fail', 'on_error'],
    outputs: ['result', 'status', 'success'],
    required: ['session', 'release'],
    badges: {
      release: 'The release to roll back.',
      revision:
        'The revision to go back to. Leave empty to go back to the revision before the current one.',
      cleanup_on_fail:
        'Delete the resources this rollback created when it fails, instead of leaving them behind.',
    },
    resultInfo: RELEASE_RESULT_INFO,
  },
  {
    id: 'helm-uninstall',
    label: 'Helm Uninstall',
    verb: 'Uninstall',
    verbFooter: 'Release to remove',
    connectionFooter: CONNECTION_FOOTER_HELM,
    timeout: '300',
    auth: false,
    // HELM-10: the K8s Delete rows helm has a flag for.
    verbRows: ['release', 'keep_history', 'ignore_not_found', 'cascade'],
    advancedRows: ADVANCED_TAIL,
    failureRows: ['on_error'],
    // HELM-10: once the release is gone there is nothing left to describe.
    outputs: ['success'],
    required: ['session', 'release'],
    badges: {
      release: 'The release to remove.',
      keep_history:
        'Keep the release history so the release can still be rolled back after it is removed.',
      ignore_not_found: 'Treat a release that is already gone as a success instead of an error.',
      cascade:
        'Choose Background to return at once and let the cluster remove the children after, Foreground to wait until the children are gone, or Orphan to leave them running.',
    },
  },
  {
    id: 'helm-test',
    label: 'Helm Test',
    verb: 'Test',
    verbFooter: "Run the chart's test hooks",
    connectionFooter: CONNECTION_FOOTER_HELM,
    timeout: '300',
    auth: false,
    verbRows: ['release', 'logs', 'output_format'],
    advancedRows: ADVANCED_TAIL,
    failureRows: ['on_error'],
    // HELM-7: the Logs output is gated on the Logs row, so it is absent here.
    outputs: ['result', 'success'],
    required: ['session', 'release'],
    badges: {
      release: 'The release whose test hooks to run.',
      logs: 'Collect what each test pod printed and report it in the Logs output.',
    },
    resultInfo: TEST_RESULT_INFO,
  },
  {
    id: 'helm-status',
    label: 'Helm Status',
    verb: 'Status',
    verbFooter: 'Release to read',
    // HELM-9: Status bounds WAVE's own read, not a helm operation.
    connectionFooter: CONNECTION_FOOTER_REQUEST,
    timeout: '30',
    auth: false,
    verbRows: ['release', 'revision', 'output_format'],
    advancedRows: ADVANCED_TAIL,
    failureRows: ['on_error'],
    outputs: ['result', 'status', 'success'],
    required: ['session', 'release'],
    badges: {
      release: 'The release to read.',
      revision: 'The revision to read. Leave empty to read the current one.',
    },
    resultInfo: RELEASE_RESULT_INFO,
  },
]

const groupOrder = (sheet: HelmSheet): string[] =>
  sheet.auth
    ? ['Connection', sheet.verb, 'Auth & TLS', 'Advanced', 'Failure Handling']
    : ['Connection', sheet.verb, 'Advanced', 'Failure Handling']

/** The groups that open folded, in the order they appear. */
const foldedGroups = (sheet: HelmSheet): string[] =>
  sheet.auth ? ['Auth & TLS', 'Advanced', 'Failure Handling'] : ['Advanced', 'Failure Handling']

const groupFooters = (sheet: HelmSheet): Record<string, string> => {
  const footers: Record<string, string> = {
    'Connection': sheet.connectionFooter,
    [sheet.verb]: sheet.verbFooter,
    'Advanced': ADVANCED_FOOTER,
    'Failure Handling': FAILURE_FOOTER,
  }
  if (sheet.auth) footers['Auth & TLS'] = AUTH_FOOTER
  return footers
}

const groupRowsOf = (sheet: HelmSheet): Record<string, string[]> => {
  const rows: Record<string, string[]> = {
    'Connection': CONNECTION_ROWS,
    [sheet.verb]: sheet.verbRows,
    'Advanced': sheet.advancedRows,
    'Failure Handling': sheet.failureRows,
  }
  if (sheet.auth) rows['Auth & TLS'] = AUTH_ROWS
  return rows
}

/** Every row of the fully expanded sheet, in DOM order. */
const sheetRowsOf = (sheet: HelmSheet): string[] => [
  ...CONNECTION_ROWS,
  ...sheet.verbRows,
  ...(sheet.auth ? AUTH_ROWS : []),
  ...sheet.advancedRows,
  ...sheet.failureRows,
]

// --- Sheet plumbing --------------------------------------------------------

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

/** Drop one Helm block on an empty canvas and open its config sheet. */
async function openHelmConfig(page: Page, sheet: HelmSheet): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'helm', testId: `palette-item-${sheet.id}` },
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

/** Open the sheet with every folded group already unfolded. */
async function openHelmConfigExpanded(page: Page, sheet: HelmSheet): Promise<Locator> {
  const modal = await openHelmConfig(page, sheet)
  for (const group of foldedGroups(sheet)) await expandGroup(modal, group)
  return modal
}

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

/** The row labels inside one group card, in DOM order, without the marker. */
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

async function setCheckbox(modal: Locator, name: string, on: boolean) {
  const box = checkbox(modal, name)
  await box.scrollIntoViewIfNeeded()
  await expect(box).toBeVisible()
  const want = on ? 'checked' : 'unchecked'
  if ((await box.getAttribute('data-state')) !== want) await box.click()
  await expect(box).toHaveAttribute('data-state', want)
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

// --- Tests -----------------------------------------------------------------

test.describe('V-PLUGIN-HELM-01: Helm config sheets and palette', () => {
  for (const sheet of SHEETS) {
    test(`HM-a ${sheet.id}: group cards in order; only Connection and ${sheet.verb} open expanded`, async ({
      page,
    }) => {
      const modal = await openHelmConfig(page, sheet)

      await expect(
        modal.getByRole('heading', { name: `${sheet.label} - Edit Config` }),
      ).toBeVisible()

      const want = groupOrder(sheet)
      const headers = modal.locator('[data-testid^="group-header-"]')
      await expect(headers).toHaveCount(want.length)
      const names = await headers.evaluateAll((els) =>
        els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
      )
      expect(names).toEqual(want)

      // Only a group holding a required row opens expanded, so Auth & TLS,
      // Advanced and Failure Handling all open folded. This supersedes the
      // wireframes, which draw Failure Handling open.
      await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
      await expect(groupHeader(modal, sheet.verb)).toHaveAttribute('aria-expanded', 'true')
      for (const group of foldedGroups(sheet)) {
        await expect(groupHeader(modal, group), group).toHaveAttribute('aria-expanded', 'false')
        // A folded card renders neither its rows nor its footer.
        expect(await groupRowIds(modal, group), group).toEqual([])
        await expect(groupFooter(modal, group), group).toHaveCount(0)
      }
      await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)

      // The Secrets collapsible sits under the groups and also opens closed.
      await expect(modal.locator('[data-testid="secrets-section-trigger"]')).toHaveAttribute(
        'data-state',
        'closed',
      )

      for (const group of foldedGroups(sheet)) await expandGroup(modal, group)

      await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(want.length)
      for (const [group, footer] of Object.entries(groupFooters(sheet))) {
        await expect(groupFooter(modal, group), group).toHaveText(footer)
      }

      // No other block's verb group ever appears on this sheet.
      for (const foreign of FOREIGN_GROUPS.filter((name) => name !== sheet.verb)) {
        await expect(
          modal.locator(`[data-testid="group-header-${foreign}"]`),
          foreign,
        ).toHaveCount(0)
      }

      await expectOnlyRequiredFlags(modal)
    })

    test(`HM-b ${sheet.id}: rows in order, required markers, defaults and the expression rule`, async ({
      page,
    }) => {
      const modal = await openHelmConfigExpanded(page, sheet)

      const expectedRows = sheetRowsOf(sheet)

      await test.step('every group holds its own rows with their exact labels', async () => {
        for (const [group, rows] of Object.entries(groupRowsOf(sheet))) {
          expect(await groupRowIds(modal, group), group).toEqual(rows)
          expect(await groupRowLabels(modal, group), group).toEqual(
            rows.map((name) => ROW_LABELS[name]),
          )
        }
        expect(await sheetRowIds(modal)).toEqual(expectedRows)
      })

      await test.step('no row another Helm block owns leaks in, and no wait row exists', async () => {
        for (const name of ALL_HELM_ROWS.filter((row) => !expectedRows.includes(row))) {
          await expect(paramRow(modal, name), name).toHaveCount(0)
        }
        // HELM-2: waiting is not an operation, so no Helm block carries a wait row.
        expect(expectedRows.filter((name) => /wait|poll/.test(name))).toEqual([])
        for (const name of ['wait', 'wait_for', 'wait_timeout', 'poll_interval']) {
          await expect(paramRow(modal, name), name).toHaveCount(0)
        }
      })

      await test.step('required markers', async () => {
        const starred: string[] = []
        for (const name of expectedRows) {
          if ((await requiredStar(modal, name).count()) > 0) starred.push(name)
        }
        expect(starred).toEqual(sheet.required)
      })

      await test.step('defaults', async () => {
        // HELM-9, FIELD-2: Timeout shows its default in gray, not as a stored value.
        await expectGrayDefault(modal, 'timeout', sheet.timeout)

        if (expectedRows.includes('output_format')) {
          expect(await readEnumOptions(page, modal, 'output_format')).toEqual(
            OUTPUT_FORMAT_OPTIONS,
          )
          await expect(
            paramRow(modal, 'output_format').getByRole('combobox'),
          ).toHaveText('Table')
        }

        expect(await readEnumOptions(page, modal, 'on_error')).toEqual(ON_ERROR_OPTIONS)
        await expect(paramRow(modal, 'on_error').getByRole('combobox')).toHaveText(
          ON_ERROR_OPTIONS[0],
        )

        if (expectedRows.includes('cascade')) {
          // The Cascade labels read as K8s Delete's do; the stored values stay
          // lower case. This supersedes the wireframe, which draws them so.
          expect(await readEnumOptions(page, modal, 'cascade')).toEqual(CASCADE_OPTIONS)
          await expect(paramRow(modal, 'cascade').getByRole('combobox')).toHaveText('Background')
        }

        const booleans = expectedRows.filter((name) => BOOLEAN_ROWS.has(name))
        const found: string[] = []
        for (const name of expectedRows) {
          if ((await checkbox(modal, name).count()) > 0) found.push(name)
        }
        expect(found, 'rows rendering a checkbox').toEqual(booleans)
        for (const name of booleans) {
          await expect(checkbox(modal, name), name).toHaveAttribute(
            'data-state',
            CHECKED_ROWS.has(name) ? 'checked' : 'unchecked',
          )
        }
      })

      await test.step('info badges and the expression-toggle rule', async () => {
        const badgeless: string[] = []
        const toggled: string[] = []
        for (const name of expectedRows) {
          const row = paramRow(modal, name)
          if ((await row.locator('td').first().locator('svg').count()) === 0) badgeless.push(name)
          if ((await row.locator('[data-testid="expression-toggle"]').count()) > 0) {
            toggled.push(name)
          }
        }
        expect(badgeless, 'rows missing the (i) info badge').toEqual([])
        expect(toggled, 'rows offering the expression toggle').toEqual(
          expectedRows.filter((name) => !NO_EXPRESSION_ROWS.has(name)),
        )

        const wording: Record<string, string> = {
          session: SESSION_INFO,
          timeout: sheet.timeout === '30' ? REQUEST_TIMEOUT_INFO : HELM_TIMEOUT_INFO,
          helm_path: HELM_PATH_INFO,
          ...(expectedRows.includes('output_format')
            ? { output_format: OUTPUT_FORMAT_INFO }
            : {}),
          ...sheet.badges,
        }
        for (const [name, text] of Object.entries(wording)) {
          await expectBadge(page, modal, paramRow(modal, name), name, text)
        }
      })
    })

    test(`HM-c ${sheet.id}: outputs under both On error settings`, async ({ page }) => {
      const modal = await openHelmConfigExpanded(page, sheet)

      const outputs = modal.locator('[data-testid^="output-row-"]')
      const recorded = [...sheet.outputs, 'error', 'reason']

      await expect(outputs).toHaveCount(sheet.outputs.length)
      expect(await outputRowIds(modal)).toEqual(sheet.outputs)

      // Error and Reason are absent, not empty, until the block records failures.
      await pickEnum(page, modal, 'on_error', 'Record and continue')
      await expect(outputs).toHaveCount(recorded.length)
      expect(await outputRowIds(modal)).toEqual(recorded)

      for (const name of recorded) {
        await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(
          OUTPUT_LABELS[name],
        )
        if (name !== 'result') {
          await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(
            new RegExp(OUTPUT_TYPES[name], 'i'),
          )
        }
        await expect(
          modal.locator(`[data-testid="output-secret-${name}"]`),
          name,
        ).toHaveAttribute('data-state', 'unchecked')
      }

      await pickEnum(page, modal, 'on_error', 'Fail the block')
      expect(await outputRowIds(modal)).toEqual(sheet.outputs)

      if (sheet.resultInfo) {
        await expectBadge(page, modal, outputRow(modal, 'result'), 'result', sheet.resultInfo)
      }
      if (sheet.outputs.includes('status')) {
        await expectBadge(page, modal, outputRow(modal, 'status'), 'status', STATUS_OUTPUT_INFO)
      }

      // HELM-6: Result is declared as whatever Output Format asks for.
      if (sheet.resultInfo) {
        for (const format of OUTPUT_FORMAT_OPTIONS) {
          await pickEnum(page, modal, 'output_format', format)
          await expect(
            outputRow(modal, 'result').locator('td:nth-child(3)'),
            format,
          ).toHaveText(new RegExp(`^${RESULT_TYPE_FOR[format]}$`, 'i'))
          expect(await outputRowIds(modal), format).toEqual(sheet.outputs)
        }
      } else {
        await expect(paramRow(modal, 'output_format')).toHaveCount(0)
        await expect(outputRow(modal, 'result')).toHaveCount(0)
        await expect(outputRow(modal, 'status')).toHaveCount(0)
      }
    })
  }

  const UPGRADE = SHEETS.find((sheet) => sheet.id === 'helm-upgrade')!
  const TEST_SHEET = SHEETS.find((sheet) => sheet.id === 'helm-test')!

  test('HM-d helm-upgrade: Reuse Values and Reset Values uncheck each other', async ({ page }) => {
    const modal = await openHelmConfig(page, UPGRADE)

    // HELM-4: ticking one clears the other, both stay enabled, both may be off,
    // never both on. No disabled state and no hidden row.
    await expect(checkbox(modal, 'reuse_values')).toHaveAttribute('data-state', 'unchecked')
    await expect(checkbox(modal, 'reset_values')).toHaveAttribute('data-state', 'unchecked')

    await setCheckbox(modal, 'reuse_values', true)
    await expect(checkbox(modal, 'reset_values')).toHaveAttribute('data-state', 'unchecked')

    await checkbox(modal, 'reset_values').click()
    await expect(checkbox(modal, 'reset_values')).toHaveAttribute('data-state', 'checked')
    await expect(checkbox(modal, 'reuse_values')).toHaveAttribute('data-state', 'unchecked')

    await checkbox(modal, 'reuse_values').click()
    await expect(checkbox(modal, 'reuse_values')).toHaveAttribute('data-state', 'checked')
    await expect(checkbox(modal, 'reset_values')).toHaveAttribute('data-state', 'unchecked')

    for (const name of ['reuse_values', 'reset_values']) {
      await expect(paramRow(modal, name), name).toBeVisible()
      await expect(checkbox(modal, name), name).toBeEnabled()
    }

    // Both off is a legal state, and neither row goes away.
    await setCheckbox(modal, 'reuse_values', false)
    await expect(checkbox(modal, 'reuse_values')).toHaveAttribute('data-state', 'unchecked')
    await expect(checkbox(modal, 'reset_values')).toHaveAttribute('data-state', 'unchecked')
    expect(await groupRowIds(modal, 'Upgrade')).toEqual(UPGRADE.verbRows)
    await expectOnlyRequiredFlags(modal)
  })

  test('HM-e helm-upgrade: Create Namespace follows Install if missing', async ({ page }) => {
    const modal = await openHelmConfig(page, UPGRADE)
    await expandGroup(modal, 'Advanced')

    // HELM-8: helm applies Create Namespace only with Install if missing on, so
    // the row is absent until then, and it lands directly under Namespace.
    expect(await groupRowIds(modal, 'Advanced')).toEqual(ADVANCED_TAIL)
    await expect(paramRow(modal, 'create_namespace')).toHaveCount(0)

    await setCheckbox(modal, 'install', true)
    expect(await groupRowIds(modal, 'Advanced')).toEqual([
      'namespace',
      'create_namespace',
      'helm_path',
      'impersonate_user',
      'impersonate_groups',
    ])
    await expect(checkbox(modal, 'create_namespace')).toHaveAttribute('data-state', 'unchecked')
    await expectBadge(
      page,
      modal,
      paramRow(modal, 'create_namespace'),
      'create_namespace',
      'Create the namespace first when it does not exist yet. helm applies it only while Install if missing is on.',
    )

    await setCheckbox(modal, 'install', false)
    expect(await groupRowIds(modal, 'Advanced')).toEqual(ADVANCED_TAIL)
    await expect(paramRow(modal, 'create_namespace')).toHaveCount(0)
  })

  test('HM-f helm-test: the Logs output appears only while the Logs row is on', async ({
    page,
  }) => {
    const modal = await openHelmConfig(page, TEST_SHEET)

    // HELM-7: an author who never asks for logs never sees a Logs variable to bind.
    expect(await outputRowIds(modal)).toEqual(['result', 'success'])
    await expect(outputRow(modal, 'logs')).toHaveCount(0)

    await setCheckbox(modal, 'logs', true)
    expect(await outputRowIds(modal)).toEqual(['result', 'logs', 'success'])
    await expect(outputRow(modal, 'logs').locator('td:nth-child(2)')).toHaveText('Logs')
    await expect(outputRow(modal, 'logs').locator('td:nth-child(3)')).toHaveText(/string/i)
    await expectBadge(page, modal, outputRow(modal, 'logs'), 'logs', LOGS_OUTPUT_INFO)

    await setCheckbox(modal, 'logs', false)
    expect(await outputRowIds(modal)).toEqual(['result', 'success'])
    await expect(outputRow(modal, 'logs')).toHaveCount(0)
  })

  test('HM-g palette: the Helm section sits between Kubernetes and Data', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const palette = page.locator('[data-testid="block-palette"]')
    const subcat = palette.locator('[data-testid="palette-subcat-helm"]')
    await expect(subcat).toBeVisible()

    // HELM-11: helm reads as the separate tool it is, so the Kubernetes verbs
    // keep their twelve and the six Helm blocks form their own section.
    await expect(subcat.locator('[data-testid="subcategory-count"]')).toHaveText('6')
    await expect(
      palette.locator('[data-testid="palette-subcat-kubernetes"] [data-testid="subcategory-count"]'),
    ).toHaveText('12')

    const order = await palette
      .locator('[data-testid^="palette-subcat-"]')
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute('data-testid') ?? '').replace('palette-subcat-', '')),
      )
    const kubernetes = order.indexOf('kubernetes')
    expect(order.slice(kubernetes, kubernetes + 3)).toEqual(['kubernetes', 'helm', 'data'])

    const header = subcat.locator('[data-testid="subcategory-header"]')
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true')

    const items = subcat.locator('[data-testid^="palette-item-"]')
    await expect(items).toHaveCount(6)
    const itemIds = await items.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('palette-item-', '')),
    )
    expect(itemIds).toEqual(SHEETS.map((sheet) => sheet.id))
    for (const sheet of SHEETS) {
      await expect(subcat.locator(`[data-testid="palette-item-${sheet.id}"]`)).toHaveText(
        sheet.label,
      )
      await expect(
        subcat.locator(`[data-testid="palette-item-${sheet.id}"]`),
        sheet.id,
      ).toHaveAttribute('draggable', 'true')
    }

    const glyphs = await items.locator('svg').evaluateAll((els) =>
      els.map((el) => el.getAttribute('class') ?? ''),
    )
    expect(glyphs).toHaveLength(6)
    expect(glyphs.every((cls) => cls.includes('text-indigo-500'))).toBe(true)

    // The palette footer handle carries the plus as an icon, not as a character.
    const handle = palette.locator('[data-testid="palette-new-block-button"]')
    await expect(handle).toHaveText('New Function')
    await expect(handle.locator('svg')).toHaveCount(1)
  })
})
