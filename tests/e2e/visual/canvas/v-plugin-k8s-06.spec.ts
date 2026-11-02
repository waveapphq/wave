/**
 * V-PLUGIN-K8S-06: K8s Apply config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SWRITE-1, K8SWRITE-2, K8SWRITE-3, K8SWRITE-4, K8SWRITE-8,
 *                   K8SREAD-10, K8SREAD-12, K8SREAD-13, K8SREAD-14, K8SREAD-15
 *
 * Criterion ids use the AP- prefix, following the per-file letter convention
 * v-plugin-k8s-01.spec.ts established.
 *
 * Pass Criteria:
 *   AP-a  the sheet is titled K8s Apply - Edit Config and carries four group
 *         cards in order Connection / Resource / Advanced / Failure Handling,
 *         with Advanced and Failure Handling opening COLLAPSED, rendering
 *         neither their rows nor their footer, and expanding on click onto
 *         their exact footer sentences
 *   AP-b  the sheet opens on Define with = Manifest: the Resource group carries
 *         Define with, Manifest, If exists and Output Format, If exists reads
 *         Update and Output Format's first option reads Array
 *   AP-c  Define with = Form with the default Kind = ConfigMap puts Name and
 *         the Data map editor where Manifest was, and Output Format's first
 *         option reads Map; exactly one Output Format row and one Data row
 *         render, the Data row is the ConfigMap's own field, and neither label
 *         is ever painted twice
 *   AP-d  Kind = Secret adds Secret Type BELOW Data, the Data row is the
 *         Secret's own field and the ConfigMap's is gone, and each of the three
 *         Secret types carries its own quick-insert list in the Data editor
 *   AP-e  Kind = Job with Job from = Image shows Image and a single-line
 *         Command string and no Environment row; Job from = CronJob replaces
 *         both with one CronJob Name row
 *   AP-f  every enum's option list, in order, with its first option: Kind
 *         offers ConfigMap, Secret and Job only, and no Namespace kind
 *   AP-g  every state's ordered row census, labels, required markers, the
 *         expression-toggle census by the ruled mode-selector distinction, an
 *         info badge on every row, and an Advanced group of exactly Namespace,
 *         Impersonate user and Impersonate groups with no reveal tick and no
 *         API version pair
 *   AP-h  verbatim info-badge text on every row the sheet opens with
 *   AP-i   verbatim info-badge text on the ConfigMap and Secret form rows
 *   AP-j  verbatim info-badge text on the Job form rows
 *   AP-k  Manifest, Image, Command and CronJob Name survive a mode round trip;
 *         neither Data field does, and the two never read each other
 *   AP-l  five outputs in order under Fail the block, seven under Record and
 *         continue, with their labels, types, unticked Secret boxes and
 *         verbatim info badges
 *   AP-m  Result's declared type follows Define with and Output Format, and
 *         never disagrees with the Output Format label on screen
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { clearPointerLock, configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { setStringParam, stringParamBox } from '../../helpers/param-config'
import { BACKEND_URL } from '../../helpers/config'
import { expectOnlyRequiredFlags } from '../../helpers/config-sheet'

const GROUP_ORDER = ['Connection', 'Resource', 'Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Resource': 'What to apply, and what to do when it is already there',
  'Advanced':
    'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const ADVANCED_ROWS = ['namespace', 'impersonate_user', 'impersonate_groups']

/** Rows that select a mode, and so must resolve while the sheet is authored (K8SWRITE-1). */
const MODE_ROWS = [
  'define_with',
  'kind',
  'secret_type',
  'job_from',
  'if_exists',
  'output_format',
  'on_error',
]

const INFO: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  define_with: 'Paste a manifest, or fill in a short form for one of the common kinds.',
  manifest:
    'The object to apply, as YAML or JSON. Several documents separated by --- are applied in order.',
  kind: 'The kind to build. Anything else goes in a manifest.',
  name: "The object's name.",
  data_configmap:
    'The keys and values to store. Point a value at a secret variable to keep it out of the config.',
  data_secret:
    'The keys and values to store. WAVE encodes them for you - do not paste base64. Values are hidden everywhere the run is recorded.',
  secret_type:
    "The Secret's type. Kubernetes fixes this when the Secret is created and will not let it change.",
  job_from:
    'Run an image you name, or run an existing CronJob now without waiting for its schedule.',
  cronjob_name:
    'The CronJob to copy. The Job runs the same thing the schedule would have run.',
  image:
    'The container image to run, like busybox:1.28 or registry.example.com/team/app:1.4.2.',
  command:
    'The command to run in the container. Write it as you would type it in a shell - quotes group arguments.',
  if_exists:
    'Update brings the object to match and can be run again safely. Fail creates it and refuses when it is already there.',
  output_format_form:
    'How Result comes back. Map is the applied object, JSON and YAML the same object as text.',
  output_format_manifest:
    'How Result comes back. Array is one applied object per document, JSON and YAML the same objects as text.',
  namespace:
    'Leave empty to use the namespace the session carries. Ignored for cluster-scoped kinds like Namespace. A manifest that names its own namespace wins.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_INFO: Record<string, string> = {
  summary:
    'One row per object: the resource and what happened to it, as kubectl prints it. Created or configured - a server-side apply cannot tell an unchanged object from a changed one.',
  result:
    'What was applied. Its type follows Output Format: a map for a form, an array for a manifest, or text for JSON and YAML.',
  names: 'The names of the objects applied, in the order they were applied',
  count:
    'How many objects were applied; with a multi-document manifest, how many landed before a failure',
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

const OUTPUT_ROWS = ['summary', 'result', 'names', 'count', 'success']
const OUTPUT_ROWS_RECORD = [...OUTPUT_ROWS, 'error', 'reason']
const OUTPUT_LABELS: Record<string, string> = {
  summary: 'Summary',
  result: 'Result',
  names: 'Names',
  count: 'Count',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}
const OUTPUT_TYPES: Record<string, RegExp> = {
  summary: /table/i,
  names: /array/i,
  count: /integer/i,
  success: /boolean/i,
  error: /string/i,
  reason: /string/i,
}

/** One authored state of the sheet and everything the sheet owes it. */
interface SheetCase {
  id: string
  kind?: 'ConfigMap' | 'Secret' | 'Job'
  jobFrom?: 'Image' | 'CronJob'
  defineWith: 'Manifest' | 'Form'
  resource: string[]
  labels: string[]
  required: string[]
  /** Rows offering the {} toggle, in DOM order, across the whole sheet. */
  expression: string[]
}

const SHEET_CASES: SheetCase[] = [
  {
    id: 'AP-g1',
    defineWith: 'Manifest',
    resource: ['define_with', 'manifest', 'if_exists', 'output_format'],
    labels: ['Define with', 'Manifest', 'If exists', 'Output Format'],
    required: ['session', 'manifest'],
    expression: [
      'session',
      'timeout',
      'manifest',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ],
  },
  {
    id: 'AP-g2',
    defineWith: 'Form',
    kind: 'ConfigMap',
    resource: ['define_with', 'kind', 'name', 'data', 'if_exists', 'output_format'],
    labels: ['Define with', 'Kind', 'Name', 'Data', 'If exists', 'Output Format'],
    required: ['session', 'kind', 'name'],
    expression: [
      'session',
      'timeout',
      'name',
      'data',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ],
  },
  {
    id: 'AP-g3',
    defineWith: 'Form',
    kind: 'Secret',
    resource: [
      'define_with',
      'kind',
      'name',
      'secret_data',
      'secret_type',
      'if_exists',
      'output_format',
    ],
    labels: [
      'Define with',
      'Kind',
      'Name',
      'Data',
      'Secret Type',
      'If exists',
      'Output Format',
    ],
    required: ['session', 'kind', 'name'],
    expression: [
      'session',
      'timeout',
      'name',
      'secret_data',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ],
  },
  {
    id: 'AP-g4',
    defineWith: 'Form',
    kind: 'Job',
    jobFrom: 'Image',
    resource: [
      'define_with',
      'kind',
      'name',
      'job_from',
      'image',
      'command',
      'if_exists',
      'output_format',
    ],
    labels: [
      'Define with',
      'Kind',
      'Name',
      'Job from',
      'Image',
      'Command',
      'If exists',
      'Output Format',
    ],
    required: ['session', 'kind', 'name', 'image'],
    expression: [
      'session',
      'timeout',
      'name',
      'image',
      'command',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ],
  },
  {
    id: 'AP-g5',
    defineWith: 'Form',
    kind: 'Job',
    jobFrom: 'CronJob',
    resource: [
      'define_with',
      'kind',
      'name',
      'job_from',
      'cronjob_name',
      'if_exists',
      'output_format',
    ],
    labels: [
      'Define with',
      'Kind',
      'Name',
      'Job from',
      'CronJob Name',
      'If exists',
      'Output Format',
    ],
    required: ['session', 'kind', 'name', 'cronjob_name'],
    expression: [
      'session',
      'timeout',
      'name',
      'cronjob_name',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ],
  },
]

const CONNECTION_ROWS = ['session', 'timeout']
const CONNECTION_LABELS = ['K8s Session', 'Timeout']
const ADVANCED_LABELS = ['Namespace', 'Impersonate user', 'Impersonate groups']

async function openApplyConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-apply' },
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

const paramRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-row-${name}"]`)

const outputRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="output-row-${name}"]`)

const groupHeader = (modal: Locator, group: string) =>
  modal.locator(`[data-testid="group-header-${group}"]`)

const groupFooter = (modal: Locator, group: string) =>
  modal.locator(`[data-testid="group-footer-${group}"]`)

/** The card wrapping one group header, so its rows can be read in DOM order. */
const groupCard = (modal: Locator, group: string) => groupHeader(modal, group).locator('..')

/** Expand a collapsible group card. Idempotent. */
async function expandGroup(modal: Locator, group: string) {
  const header = groupHeader(modal, group)
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** Open the two folded cards so the whole sheet can be read in one pass. */
async function expandAll(modal: Locator) {
  for (const group of COLLAPSED_GROUPS) await expandGroup(modal, group)
}

/** The param row ids inside one group card, in DOM order. */
async function groupRowIds(modal: Locator, group: string): Promise<string[]> {
  return groupCard(modal, group)
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

/** Every visible param row id on the sheet, in DOM order. */
async function rowIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

/** Every visible row label, in DOM order, without the required marker. */
async function rowLabels(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="param-row-"] td:nth-child(2)')
    .evaluateAll((cells) =>
      cells.map((td) => (td.textContent ?? '').replace(/\*\s*required$/, '').trim()),
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

/** The option labels of an enum row, in order, read without changing the value. */
async function enumOptions(page: Page, modal: Locator, name: string): Promise<string[]> {
  const trigger = paramRow(modal, name).locator('button[role="combobox"]')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  const labels = await listbox.getByRole('option').allInnerTexts()
  // Escape closes the listbox only; the config sheet stays open.
  await page.keyboard.press('Escape')
  await expect(listbox).toHaveCount(0)
  await expect(modal).toBeVisible()
  return labels.map((text) => text.trim())
}

/** Drive the sheet into one authored state. */
async function applyState(page: Page, modal: Locator, sheetCase: SheetCase) {
  await pickEnum(page, modal, 'define_with', sheetCase.defineWith)
  if (sheetCase.kind) await pickEnum(page, modal, 'kind', sheetCase.kind)
  if (sheetCase.jobFrom) await pickEnum(page, modal, 'job_from', sheetCase.jobFrom)
}

async function expectInfoBadge(page: Page, row: Locator, label: string, text: string) {
  const icon = row.locator('.cursor-help')
  await icon.scrollIntoViewIfNeeded()
  await icon.hover()
  await waitForTooltipVisible(page, label, 5_000)
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  await expect(tooltip, label).toBeVisible({ timeout: 5_000 })
  // Radix paints the wording twice; [role="tooltip"] is the single accessible copy.
  await expect(tooltip.locator('[role="tooltip"]'), label).toHaveText(text)
  await page.mouse.move(0, 0)
  await waitForTooltipClosed(page, label, 5_000)
  await expect(tooltip, label).toHaveCount(0)
}

/** Open one Data row's map editor from the field's expand, a page-level overlay beside the config sheet. */
async function openDataEditor(page: Page, modal: Locator, name: string): Promise<Locator> {
  const row = paramRow(modal, name)
  await row.scrollIntoViewIfNeeded()
  await modal.locator(`[data-testid="param-expand-${name}"]`).click()
  const editor = page.locator('[data-testid="value-editor-sheet"]')
  await expect(editor).toBeVisible()
  return editor
}

/** A Data row's one value field: its entries on one line, empty when it holds none (FIELD-1). */
const dataField = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('[data-slot="input-group"] input').first()

/** Type one key and value into a Data row's editor and save it. */
async function fillDataEntry(
  page: Page,
  modal: Locator,
  name: string,
  key: string,
  value: string,
) {
  const editor = await openDataEditor(page, modal, name)
  await editor.locator('[data-testid="map-add-entry"]').click()
  await editor.locator('[data-testid="map-edit-key-0"]').fill(key)
  await editor.locator('[data-testid="map-edit-value-0"]').fill(value)
  await editor.locator('[data-testid="value-editor-save-button"]').click()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()
}

async function closeDataEditor(editor: Locator) {
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()
}

/** The quick-insert key names one Data descriptor offers, [] when it offers no menu. */
async function quickInsertKeys(page: Page, editor: Locator): Promise<string[]> {
  const trigger = editor.getByRole('button', { name: '+ Key' })
  if ((await trigger.count()) === 0) return []
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const keys = await menu.getByRole('menuitem').allInnerTexts()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await clearPointerLock(page)
  return keys.map((text) => text.trim())
}

/** The declared type of the Result output; it lags the input by a render. */
async function resultType(modal: Locator): Promise<string> {
  const raw = await outputRow(modal, 'result').locator('td:nth-child(3)').innerText()
  return raw.trim().toLowerCase()
}

test.describe('V-PLUGIN-K8S-06: K8s Apply config sheet', () => {
  test('AP-a: four groups in order; Advanced and Failure Handling open collapsed and expand on click', async ({
    page,
  }) => {
    const modal = await openApplyConfig(page)
    await expect(modal).toContainText('K8s Apply - Edit Config')

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // Apply is a write block; the read blocks' verb groups never appear on it.
    for (const foreign of ['Events', 'Logs', 'Measurement', 'Scale', 'Rollout']) {
      await expect(modal.locator(`[data-testid="group-header-${foreign}"]`)).toHaveCount(0)
    }

    // K8SREAD-10: the sheet opens on the rows an author has to fill in.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Resource')).toHaveAttribute('aria-expanded', 'true')
    for (const group of COLLAPSED_GROUPS) {
      await expect(groupHeader(modal, group)).toHaveAttribute('aria-expanded', 'false')
      // A folded card renders neither its rows nor its footer.
      expect(await groupRowIds(modal, group)).toEqual([])
      await expect(groupFooter(modal, group)).toHaveCount(0)
    }
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)

    expect(await groupRowIds(modal, 'Connection')).toEqual(CONNECTION_ROWS)

    await expandAll(modal)
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(4)
    expect(await groupRowIds(modal, 'Failure Handling')).toEqual(['on_error'])
    for (const [group, footer] of Object.entries(GROUP_FOOTERS)) {
      await expect(groupFooter(modal, group)).toHaveText(footer)
    }

    // FIELDERR-3: a fresh sheet flags its empty required rows at once, and nothing else.
    await expectOnlyRequiredFlags(modal)
  })

  test('AP-b: the sheet opens on Manifest with If exists Update and an Output Format whose first option reads Array', async ({
    page,
  }) => {
    const modal = await openApplyConfig(page)

    await expect(paramRow(modal, 'define_with').locator('button[role="combobox"]')).toHaveText(
      'Manifest',
    )
    expect(await groupRowIds(modal, 'Resource')).toEqual([
      'define_with',
      'manifest',
      'if_exists',
      'output_format',
    ])
    const formOnly = [
      'kind',
      'name',
      'data',
      'secret_data',
      'secret_type',
      'job_from',
      'image',
      'command',
      'cronjob_name',
    ]
    for (const name of formOnly) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }

    await expect(paramRow(modal, 'if_exists').locator('button[role="combobox"]')).toHaveText(
      'Update',
    )
    // K8SREAD-15: the format option is named after the type Result yields.
    await expect(
      paramRow(modal, 'output_format').locator('button[role="combobox"]'),
    ).toHaveText('Array')
    expect(await enumOptions(page, modal, 'output_format')).toEqual(['Array', 'JSON', 'YAML'])

    // The Manifest value is a multi-format string, not a map or a list: one text field and its expand.
    await expect(stringParamBox(modal, 'manifest')).toHaveCount(1)
    await expect(modal.locator('[data-testid="param-expand-manifest"]')).toHaveCount(1)
    await expect(paramRow(modal, 'manifest').locator('td:nth-child(3)')).toHaveText(/string/i)
  })

  test('AP-c: Form with the default Kind ConfigMap swaps Manifest for Name and Data, and paints each shared label once', async ({
    page,
  }) => {
    const modal = await openApplyConfig(page)
    await pickEnum(page, modal, 'define_with', 'Form')

    // ConfigMap is the kind the form opens on.
    await expect(paramRow(modal, 'kind').locator('button[role="combobox"]')).toHaveText(
      'ConfigMap',
    )
    expect(await groupRowIds(modal, 'Resource')).toEqual([
      'define_with',
      'kind',
      'name',
      'data',
      'if_exists',
      'output_format',
    ])
    await expect(paramRow(modal, 'manifest')).toHaveCount(0)

    // The Secret's three Data descriptors and the two Output Format ones each
    // share a wire name; exactly one Data row and one Output Format row ever
    // render, so neither label is painted twice.
    await expect(paramRow(modal, 'data')).toHaveCount(1)
    await expect(paramRow(modal, 'secret_data')).toHaveCount(0)
    await expect(paramRow(modal, 'output_format')).toHaveCount(1)
    const labels = await rowLabels(modal)
    expect(labels.filter((label) => label === 'Data')).toEqual(['Data'])
    expect(labels.filter((label) => label === 'Output Format')).toEqual(['Output Format'])

    // K8SWRITE-2: a form builds one object, so the first option reads Map.
    await expect(
      paramRow(modal, 'output_format').locator('button[role="combobox"]'),
    ).toHaveText('Map')
    expect(await enumOptions(page, modal, 'output_format')).toEqual(['Map', 'JSON', 'YAML'])

    // The Data row is a map editor, empty on a fresh sheet.
    await expect(paramRow(modal, 'data').locator('td:nth-child(3)')).toHaveText(/map/i)
    await expect(dataField(modal, 'data')).toHaveValue('')

    // ConfigMap offers no quick inserts; its values are not typed by Kubernetes.
    const editor = await openDataEditor(page, modal, 'data')
    expect(await quickInsertKeys(page, editor)).toEqual([])
    await closeDataEditor(editor)
  })

  test('AP-d: Kind Secret puts Secret Type below Data and gives each Secret type its own quick inserts', async ({
    page,
  }) => {
    const modal = await openApplyConfig(page)
    await pickEnum(page, modal, 'define_with', 'Form')
    await pickEnum(page, modal, 'kind', 'Secret')

    // K8SWRITE-3: Data sits ABOVE Secret Type on this sheet, and it is the
    // Secret's own field, so the ConfigMap's is not on the sheet at all.
    expect(await groupRowIds(modal, 'Resource')).toEqual([
      'define_with',
      'kind',
      'name',
      'secret_data',
      'secret_type',
      'if_exists',
      'output_format',
    ])
    await expect(paramRow(modal, 'data')).toHaveCount(0)
    expect(await rowLabels(modal)).toContain('Data')
    await expect(paramRow(modal, 'secret_data').locator('td:nth-child(3)')).toHaveText(/map/i)
    await expect(paramRow(modal, 'secret_type').locator('button[role="combobox"]')).toHaveText(
      'Opaque',
    )

    const quickInserts: Record<string, string[]> = {
      'Opaque': [],
      'kubernetes.io/tls': ['tls.crt', 'tls.key'],
      'kubernetes.io/dockerconfigjson': ['.dockerconfigjson'],
    }
    for (const [secretType, keys] of Object.entries(quickInserts)) {
      await test.step(`Secret Type ${secretType}`, async () => {
        await pickEnum(page, modal, 'secret_type', secretType)
        // Only the quick-insert list changes; the row set stays put.
        await expect(paramRow(modal, 'secret_data')).toHaveCount(1)
        await expect(paramRow(modal, 'data')).toHaveCount(0)
        const editor = await openDataEditor(page, modal, 'secret_data')
        expect(await quickInsertKeys(page, editor), secretType).toEqual(keys)
        await closeDataEditor(editor)
      })
    }
  })

  test('AP-e: Kind Job carries Image and a single-line Command, and CronJob replaces both with CronJob Name', async ({
    page,
  }) => {
    const modal = await openApplyConfig(page)
    await pickEnum(page, modal, 'define_with', 'Form')
    await pickEnum(page, modal, 'kind', 'Job')

    await expect(paramRow(modal, 'job_from').locator('button[role="combobox"]')).toHaveText(
      'Image',
    )
    expect(await groupRowIds(modal, 'Resource')).toEqual([
      'define_with',
      'kind',
      'name',
      'job_from',
      'image',
      'command',
      'if_exists',
      'output_format',
    ])
    // K8SWRITE-4: no Environment row exists on the Job form.
    expect(await rowLabels(modal)).not.toContain('Environment')
    expect(await rowLabels(modal)).not.toContain('Data')
    for (const name of ['data', 'secret_data', 'secret_type']) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }

    // Command is one string, not a list: one text field typed String.
    await expect(stringParamBox(modal, 'command')).toHaveCount(1)
    await expect(paramRow(modal, 'command').locator('td:nth-child(3)')).toHaveText(/string/i)

    await pickEnum(page, modal, 'job_from', 'CronJob')
    expect(await groupRowIds(modal, 'Resource')).toEqual([
      'define_with',
      'kind',
      'name',
      'job_from',
      'cronjob_name',
      'if_exists',
      'output_format',
    ])
    for (const name of ['image', 'command']) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }
  })

  test('AP-f: every enum option list, in order, with its first option', async ({ page }) => {
    const modal = await openApplyConfig(page)

    expect(await enumOptions(page, modal, 'define_with')).toEqual(['Manifest', 'Form'])
    expect(await enumOptions(page, modal, 'if_exists')).toEqual(['Update', 'Fail'])

    await expandGroup(modal, 'Failure Handling')
    expect(await enumOptions(page, modal, 'on_error')).toEqual([
      'Fail the block',
      'Record and continue',
    ])
    await expect(paramRow(modal, 'on_error').locator('button[role="combobox"]')).toHaveText(
      'Fail the block',
    )

    await pickEnum(page, modal, 'define_with', 'Form')
    // K8SWRITE-1: three form kinds, and no Namespace kind.
    const kinds = await enumOptions(page, modal, 'kind')
    expect(kinds).toEqual(['ConfigMap', 'Secret', 'Job'])
    expect(kinds).not.toContain('Namespace')

    // The wire values render verbatim and are marked not to be translated.
    const kindTrigger = paramRow(modal, 'kind').locator('button[role="combobox"]')
    await kindTrigger.click()
    const listbox = page.locator('[role="listbox"]')
    await expect(listbox).toBeVisible()
    await expect(listbox.locator('[role="option"] span[translate="no"]')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(listbox).toHaveCount(0)

    await pickEnum(page, modal, 'kind', 'Secret')
    // K8SWRITE-3: basic-auth and ssh-auth are deliberately absent.
    expect(await enumOptions(page, modal, 'secret_type')).toEqual([
      'Opaque',
      'kubernetes.io/tls',
      'kubernetes.io/dockerconfigjson',
    ])

    await pickEnum(page, modal, 'kind', 'Job')
    expect(await enumOptions(page, modal, 'job_from')).toEqual(['Image', 'CronJob'])
  })

  test('AP-g: every state renders its own rows, labels, required markers, expression toggles and info badges', async ({
    page,
  }) => {
    const modal = await openApplyConfig(page)
    await expandAll(modal)

    // K8SREAD-12/13: Advanced is a plain namespace and two impersonation rows,
    // with no reveal tick above them and no API version pair.
    expect(await groupRowIds(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    await expect(groupCard(modal, 'Advanced').locator('button[role="checkbox"]')).toHaveCount(0)
    await expect(stringParamBox(modal, 'namespace')).toHaveCount(1)

    for (const sheetCase of SHEET_CASES) {
      await test.step(`${sheetCase.id}: Define with ${sheetCase.defineWith}${sheetCase.kind ? `, Kind ${sheetCase.kind}` : ''}${sheetCase.jobFrom ? `, Job from ${sheetCase.jobFrom}` : ''}`, async () => {
        await applyState(page, modal, sheetCase)

        expect(await groupRowIds(modal, 'Resource'), `${sheetCase.id} Resource rows`).toEqual(
          sheetCase.resource,
        )
        expect(await groupRowIds(modal, 'Advanced'), `${sheetCase.id} Advanced rows`).toEqual(
          ADVANCED_ROWS,
        )

        const ids = await rowIds(modal)
        expect(ids, `${sheetCase.id} sheet rows`).toEqual([
          ...CONNECTION_ROWS,
          ...sheetCase.resource,
          ...ADVANCED_ROWS,
          'on_error',
        ])
        expect(await rowLabels(modal), `${sheetCase.id} labels`).toEqual([
          ...CONNECTION_LABELS,
          ...sheetCase.labels,
          ...ADVANCED_LABELS,
          'On error',
        ])

        const starred: string[] = []
        const badgeless: string[] = []
        const toggled: string[] = []
        for (const name of ids) {
          const row = paramRow(modal, name)
          if ((await row.locator('td:nth-child(2) span.text-destructive').count()) > 0)
            starred.push(name)
          if ((await row.locator('td').first().locator('svg').count()) === 0) badgeless.push(name)
          if ((await row.locator('[data-testid="expression-toggle"]').count()) > 0)
            toggled.push(name)
        }

        expect(starred, `${sheetCase.id} required markers`).toEqual(sheetCase.required)
        expect(badgeless, `${sheetCase.id} rows missing the (i) info badge`).toEqual([])
        // The mode selectors drop the toggle; every row that names the object keeps it.
        expect(toggled, `${sheetCase.id} rows offering the expression toggle`).toEqual(
          sheetCase.expression,
        )
        expect(
          ids.filter((name) => !toggled.includes(name)),
          `${sheetCase.id} mode selectors`,
        ).toEqual(MODE_ROWS.filter((name) => ids.includes(name)))
      })
    }
  })

  test('AP-h: verbatim info badges on every row the sheet opens with', async ({ page }) => {
    const modal = await openApplyConfig(page)
    await expandAll(modal)

    const rows = [
      'session',
      'timeout',
      'define_with',
      'manifest',
      'if_exists',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ]
    for (const name of rows) {
      await expectInfoBadge(page, paramRow(modal, name), name, INFO[name])
    }
    await expectInfoBadge(
      page,
      paramRow(modal, 'output_format'),
      'output_format (Manifest)',
      INFO.output_format_manifest,
    )
  })

  test('AP-i: verbatim info badges on the ConfigMap and Secret form rows', async ({ page }) => {
    const modal = await openApplyConfig(page)
    await pickEnum(page, modal, 'define_with', 'Form')

    for (const name of ['kind', 'name']) {
      await expectInfoBadge(page, paramRow(modal, name), name, INFO[name])
    }
    await expectInfoBadge(page, paramRow(modal, 'data'), 'data (ConfigMap)', INFO.data_configmap)
    await expectInfoBadge(
      page,
      paramRow(modal, 'output_format'),
      'output_format (Form)',
      INFO.output_format_form,
    )

    await pickEnum(page, modal, 'kind', 'Secret')
    await expectInfoBadge(
      page,
      paramRow(modal, 'secret_data'),
      'secret_data (Secret)',
      INFO.data_secret,
    )
    await expectInfoBadge(page, paramRow(modal, 'secret_type'), 'secret_type', INFO.secret_type)

    // All three Secret types share one badge, so only the quick inserts change.
    for (const secretType of ['kubernetes.io/tls', 'kubernetes.io/dockerconfigjson']) {
      await pickEnum(page, modal, 'secret_type', secretType)
      await expectInfoBadge(
        page,
        paramRow(modal, 'secret_data'),
        `secret_data (${secretType})`,
        INFO.data_secret,
      )
    }
  })

  test('AP-j: verbatim info badges on the Job form rows', async ({ page }) => {
    const modal = await openApplyConfig(page)
    await pickEnum(page, modal, 'define_with', 'Form')
    await pickEnum(page, modal, 'kind', 'Job')

    for (const name of ['job_from', 'image', 'command']) {
      await expectInfoBadge(page, paramRow(modal, name), name, INFO[name])
    }

    await pickEnum(page, modal, 'job_from', 'CronJob')
    await expectInfoBadge(page, paramRow(modal, 'cronjob_name'), 'cronjob_name', INFO.cronjob_name)
  })

  test('AP-k: typed form values survive a mode round trip, and neither Data field does', async ({
    page,
  }) => {
    const modal = await openApplyConfig(page)

    // The Manifest body comes back after a trip through the form.
    await paramRow(modal, 'manifest').scrollIntoViewIfNeeded()
    await setStringParam(modal, page, 'manifest', 'kind: ConfigMap')
    await pickEnum(page, modal, 'define_with', 'Form')
    await expect(paramRow(modal, 'manifest')).toHaveCount(0)
    await pickEnum(page, modal, 'define_with', 'Manifest')
    await expect(stringParamBox(modal, 'manifest')).toHaveValue('kind: ConfigMap')

    // Image and Command come back after a trip through the CronJob form.
    await pickEnum(page, modal, 'define_with', 'Form')
    await pickEnum(page, modal, 'kind', 'Job')
    await paramRow(modal, 'image').scrollIntoViewIfNeeded()
    await setStringParam(modal, page, 'image', 'busybox:1.28')
    await paramRow(modal, 'command').scrollIntoViewIfNeeded()
    await setStringParam(modal, page, 'command', 'sleep 5')
    await pickEnum(page, modal, 'job_from', 'CronJob')
    await paramRow(modal, 'cronjob_name').scrollIntoViewIfNeeded()
    await setStringParam(modal, page, 'cronjob_name', 'nightly-cleanup')
    for (const name of ['image', 'command']) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }
    await pickEnum(page, modal, 'job_from', 'Image')
    await expect(stringParamBox(modal, 'image')).toHaveValue('busybox:1.28')
    await expect(stringParamBox(modal, 'command')).toHaveValue('sleep 5')
    await pickEnum(page, modal, 'job_from', 'CronJob')
    await expect(stringParamBox(modal, 'cronjob_name')).toHaveValue('nightly-cleanup')

    // Neither Data field is retained, so a Kind with no Data row of its own
    // drops what was typed; and the two fields never read each other.
    await pickEnum(page, modal, 'kind', 'ConfigMap')
    await fillDataEntry(page, modal, 'data', 'LOG_LEVEL', 'debug')
    await expect(dataField(modal, 'data')).toHaveValue('{"LOG_LEVEL": "debug"}')

    await pickEnum(page, modal, 'kind', 'Secret')
    await expect(dataField(modal, 'secret_data')).toHaveValue('')
    await fillDataEntry(page, modal, 'secret_data', 'token', 'kept-apart')
    await expect(dataField(modal, 'secret_data')).toHaveValue(/"token"/)

    await pickEnum(page, modal, 'kind', 'Job')
    for (const name of ['data', 'secret_data']) {
      await expect(paramRow(modal, name), name).toHaveCount(0)
    }
    await pickEnum(page, modal, 'kind', 'ConfigMap')
    await expect(dataField(modal, 'data')).toHaveValue('')
    await pickEnum(page, modal, 'kind', 'Secret')
    await expect(dataField(modal, 'secret_data')).toHaveValue('')
  })

  test('AP-l: five outputs under Fail the block, seven under Record and continue', async ({
    page,
  }) => {
    const modal = await openApplyConfig(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUT_ROWS.length)
    const ids = await outputs.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', '')),
    )
    expect(ids).toEqual(OUTPUT_ROWS)

    // K8SWRITE-8: Error and Reason cannot be bound while the block fails hard.
    for (const name of ['error', 'reason']) {
      await expect(outputRow(modal, name), name).toHaveCount(0)
    }

    await expandGroup(modal, 'Failure Handling')
    await pickEnum(page, modal, 'on_error', 'Record and continue')
    await expect(outputs).toHaveCount(OUTPUT_ROWS_RECORD.length)
    const recordIds = await outputs.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', '')),
    )
    expect(recordIds).toEqual(OUTPUT_ROWS_RECORD)

    for (const name of OUTPUT_ROWS_RECORD) {
      const row = outputRow(modal, name)
      await expect(row.locator('td:nth-child(2)'), name).toHaveText(OUTPUT_LABELS[name])
      if (OUTPUT_TYPES[name]) {
        await expect(row.locator('td:nth-child(3)'), name).toHaveText(OUTPUT_TYPES[name])
      }
      // Nothing on Apply is secret by default, and every box stays reachable.
      await expect(modal.locator(`[data-testid="output-secret-${name}"]`), name).toHaveAttribute(
        'data-state',
        'unchecked',
      )
      await expectInfoBadge(page, row, name, OUTPUT_INFO[name])
    }

    await pickEnum(page, modal, 'on_error', 'Fail the block')
    await expect(outputs).toHaveCount(OUTPUT_ROWS.length)
    for (const name of ['error', 'reason']) {
      await expect(outputRow(modal, name), name).toHaveCount(0)
    }
  })

  test('AP-m: Result takes the type its Define with and Output Format yield', async ({ page }) => {
    const modal = await openApplyConfig(page)

    // K8SWRITE-2: a manifest applies one object per document, so Result is an array.
    await expect.poll(() => resultType(modal), { message: 'Manifest + Array' }).toBe('array')

    for (const format of ['JSON', 'YAML']) {
      await pickEnum(page, modal, 'output_format', format)
      await expect
        .poll(() => resultType(modal), { message: `Manifest + ${format}` })
        .toBe('string')
    }

    // Output Format is one stored field behind two labels, so the choice rides
    // the mode switch and only the first option's word changes.
    await pickEnum(page, modal, 'define_with', 'Form')
    await expect(
      paramRow(modal, 'output_format').locator('button[role="combobox"]'),
    ).toHaveText('YAML')
    await expect.poll(() => resultType(modal), { message: 'Form + YAML' }).toBe('string')

    await pickEnum(page, modal, 'output_format', 'Map')
    await expect.poll(() => resultType(modal), { message: 'Form + Map' }).toBe('map')

    await pickEnum(page, modal, 'define_with', 'Manifest')
    await expect(
      paramRow(modal, 'output_format').locator('button[role="combobox"]'),
    ).toHaveText('Array')
    await expect.poll(() => resultType(modal), { message: 'Manifest + Array' }).toBe('array')
  })
})
