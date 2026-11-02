/**
 * V-PLUGIN-K8S-07: K8s Delete config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SWRITE-5, K8SWRITE-8, K8SREAD-2, K8SREAD-4, K8SREAD-5,
 *                   K8SREAD-8, K8SREAD-10, K8SREAD-12, K8SREAD-14
 *
 * Criterion ids use the DL- prefix, following the per-file letter convention
 * v-plugin-k8s-01.spec.ts established.
 *
 * Pass Criteria:
 *   DL-a  four groups in order Connection / Resource / Advanced / Failure
 *         Handling; Connection and Resource open expanded, Advanced and Failure
 *         Handling open COLLAPSED rendering neither rows nor footer, and every
 *         expanded card carries its exact footer note
 *   DL-b  the four Resource Type x Delete by states each render their own
 *         ordered Resource rows, and no state anywhere offers a Field Selector,
 *         an All namespaces or an Output Format row, or a foreign verb group
 *   DL-c  every row's label, and the required markers moving with the mode:
 *         K8s Session plus the Kind row and the object row the mode is on
 *   DL-d  Resource Type swaps Kind between the grouped searchable picker and a
 *         plain required string row, and the picked kind and the typed custom
 *         kind both survive the round trip
 *   DL-e  the Kind picker is the shared grouped searchable control: it opens
 *         on Pod, written when the Block is created (FIELD-8), five band headings in order, 23 kinds alphabetical inside
 *         each band, CronJob first, short names inline, and Escape closes the
 *         picker leaving the sheet OPEN
 *   DL-f  Delete by swaps Name for Label Selector and takes Ignore not found
 *         with it; both typed values survive the round trip while the Ignore
 *         not found tick does not
 *   DL-g  every enum's option list in order with the option it opens on;
 *         Cascade holds each of its three values without moving a row; Grace
 *         Period (s) opens empty; Ignore not found opens unticked and Wait
 *         until gone opens ticked
 *   DL-h  the expression toggle follows the mode rule: the rows that select a
 *         mode carry none, the rows that name the object carry one, and so do
 *         both Booleans
 *   DL-i  every input row leads with the info badge and its wording is exact,
 *         the Custom Kind row included
 *   DL-j  four outputs led by Summary in the default On error mode, six under
 *         Record and continue, and four again on the way back
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { expectGrayDefault } from '../../helpers/default-rule'
import { waitForTooltipClosed, waitForTooltipText } from '../../helpers/tooltip-wait'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { expectStringParamPreview, setStringParam } from '../../helpers/param-config'
import { expectOnlyRequiredFlags } from '../../helpers/config-sheet'

const GROUP_ORDER = ['Connection', 'Resource', 'Advanced', 'Failure Handling']
const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Resource': 'What to delete, and how thoroughly',
  'Advanced': 'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

/** Verb groups that belong to other K8s blocks and must never appear here. */
const FOREIGN_GROUPS = ['Events', 'Logs', 'Measurement', 'Scale', 'Rollout']

/** Rows K8SWRITE-5 keeps off the Delete sheet, in every state. */
const ABSENT_ROWS = ['field_selector', 'all_namespaces', 'output_format']

const CONNECTION_ROWS = ['session', 'timeout']
const ADVANCED_ROWS = ['namespace', 'impersonate_user', 'impersonate_groups']

const KIND_TRIGGER = '[data-testid="enum-picker-trigger-kind"]'
const KIND_CONTENT = '[data-testid="enum-picker-content-kind"]'
const KIND_SEARCH = '[data-testid="enum-picker-search-kind"]'
const KIND_ITEM = '[data-testid^="enum-picker-item-kind-"]'
const KIND_BANDS = ['Workloads', 'Networking', 'Config', 'Storage', 'Cluster']
const KIND_COUNT = 23
/** FIELD-8: Kind holds its default, written when the Block is created. */
const KIND_AT_CREATION = 'Pod'

const PICKED_KIND = 'Deployment'
const CUSTOM_KIND = 'widgets.example.com'
const TYPED_NAME = 'checkout-api'
const TYPED_SELECTOR = 'app=checkout'

const ROW_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  resource_type: 'Resource Type',
  kind: 'Kind',
  kind_custom: 'Kind',
  delete_by: 'Delete by',
  name: 'Name',
  label_selector: 'Label Selector',
  ignore_not_found: 'Ignore not found',
  cascade: 'Cascade',
  grace_period_seconds: 'Grace Period (s)',
  wait_until_gone: 'Wait until gone',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

const ROW_INFO: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  resource_type:
    'Default offers the kinds a stock cluster serves. Custom takes any other kind as plain text, including custom resources.',
  kind: 'The resource kind, as kubectl names it. Search the list, or switch Resource Type to Custom to type one that is not in it.',
  kind_custom:
    'The kind exactly as the cluster names it. A kind this cluster does not serve fails the block.',
  delete_by: 'Delete one object by name, or every object that matches a selector.',
  name: "The object's name. A name that is already gone is an error, exactly as in kubectl, unless Ignore not found is ticked.",
  label_selector:
    'Match objects by label, like app=web or tier in (a,b). Every object that matches is deleted.',
  ignore_not_found:
    "Treat a name that is already gone as a success instead of an error. Same as kubectl's --ignore-not-found.",
  cascade:
    'Background returns at once and the cluster removes the children after. Foreground waits until the children are gone. Orphan leaves them running.',
  grace_period_seconds:
    "How long the object gets to shut down. 0 removes it immediately. Leave empty for the kind's own default.",
  wait_until_gone:
    "Keep checking until the object is really gone, within the block's timeout. kubectl waits by default; untick to return as soon as the cluster accepts the delete.",
  namespace:
    'Leave empty to use the namespace the session carries. Ignored for cluster-scoped kinds like Node or PersistentVolume.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_ROWS_FAIL = ['summary', 'names', 'count', 'success']
const OUTPUT_ROWS_RECORD = ['summary', 'names', 'count', 'success', 'error', 'reason']

const OUTPUT_LABELS: Record<string, string> = {
  summary: 'Summary',
  names: 'Names',
  count: 'Count',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const OUTPUT_TYPES: Record<string, string> = {
  summary: 'table',
  names: 'array',
  count: 'integer',
  success: 'boolean',
  error: 'string',
  reason: 'string',
}

const OUTPUT_INFO: Record<string, string> = {
  summary: 'One row per object: the resource and what happened to it, as kubectl prints it.',
  names: 'The names of the objects deleted, in the order the cluster reported them',
  count: 'How many objects were deleted; 0 when a selector matched nothing',
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

type ResourceTypeLabel = 'Default' | 'Custom'
type DeleteByLabel = 'Name' | 'Selector'

interface SheetState {
  id: string
  resourceType: ResourceTypeLabel
  deleteBy: DeleteByLabel
  resource: string[]
  required: string[]
}

/** The checklist, in code: every Resource Type x Delete by pair and its rows. */
const SHEET_STATES: SheetState[] = [
  {
    id: 'DL-b1',
    resourceType: 'Default',
    deleteBy: 'Name',
    resource: [
      'resource_type',
      'kind',
      'delete_by',
      'name',
      'ignore_not_found',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
    ],
    required: ['session', 'kind', 'name'],
  },
  {
    id: 'DL-b2',
    resourceType: 'Custom',
    deleteBy: 'Name',
    resource: [
      'resource_type',
      'kind_custom',
      'delete_by',
      'name',
      'ignore_not_found',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
    ],
    required: ['session', 'kind_custom', 'name'],
  },
  {
    id: 'DL-b3',
    resourceType: 'Default',
    deleteBy: 'Selector',
    resource: [
      'resource_type',
      'kind',
      'delete_by',
      'label_selector',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
    ],
    required: ['session', 'kind', 'label_selector'],
  },
  {
    id: 'DL-b4',
    resourceType: 'Custom',
    deleteBy: 'Selector',
    resource: [
      'resource_type',
      'kind_custom',
      'delete_by',
      'label_selector',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
    ],
    required: ['session', 'kind_custom', 'label_selector'],
  },
]

interface EnumRow {
  name: string
  options: string[]
  opensOn: string
}

const ENUM_ROWS: EnumRow[] = [
  { name: 'resource_type', options: ['Default', 'Custom'], opensOn: 'Default' },
  { name: 'delete_by', options: ['Name', 'Selector'], opensOn: 'Name' },
  {
    name: 'cascade',
    options: ['Background', 'Foreground', 'Orphan'],
    opensOn: 'Background',
  },
  {
    name: 'on_error',
    options: ['Fail the block', 'Record and continue'],
    opensOn: 'Fail the block',
  },
]

/** A mode row decides which other rows render, so it resolves while the sheet is authored. */
const NO_EXPRESSION_ROWS = ['resource_type', 'delete_by', 'cascade', 'on_error']

const EXPRESSION_ROWS_DEFAULT_NAME = [
  'session',
  'timeout',
  'kind',
  'name',
  'ignore_not_found',
  'grace_period_seconds',
  'wait_until_gone',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
]

const EXPRESSION_ROWS_CUSTOM_SELECTOR = [
  'session',
  'timeout',
  'kind_custom',
  'label_selector',
  'grace_period_seconds',
  'wait_until_gone',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
]

async function openDeleteConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-delete' },
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

const checkbox = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('button[role="checkbox"]')

/** Expand a collapsible group card. Idempotent. */
async function expandGroup(modal: Locator, group: string) {
  const header = groupHeader(modal, group)
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** The param row ids inside one group card, in DOM order. */
async function groupRowIds(modal: Locator, group: string): Promise<string[]> {
  const card = groupHeader(modal, group).locator('..')
  return card
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

/** Every visible param row on the sheet, in DOM order. */
async function visibleRowIds(modal: Locator): Promise<string[]> {
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

/** The name cell text without the required marker's "*" and its sr-only word. */
async function rowLabel(modal: Locator, name: string): Promise<string> {
  return paramRow(modal, name)
    .locator('td:nth-child(2)')
    .evaluate((td) => (td.textContent ?? '').replace(/\*\s*required$/, '').trim())
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

async function setCheckbox(modal: Locator, name: string, on: boolean) {
  const box = checkbox(modal, name)
  await box.scrollIntoViewIfNeeded()
  await expect(box).toBeVisible()
  const want = on ? 'checked' : 'unchecked'
  if ((await box.getAttribute('data-state')) !== want) await box.click()
  await expect(box).toHaveAttribute('data-state', want)
}

async function setStringRow(page: Page, modal: Locator, name: string, value: string) {
  await paramRow(modal, name).scrollIntoViewIfNeeded()
  await setStringParam(modal, page, name, value)
}

/** Put the sheet into one Resource Type x Delete by state. */
async function applyState(page: Page, modal: Locator, state: SheetState) {
  await pickEnum(page, modal, 'resource_type', state.resourceType)
  await pickEnum(page, modal, 'delete_by', state.deleteBy)
}

/** Testids of the picker rows, in DOM order. */
async function kindItemIds(page: Page): Promise<string[]> {
  return page
    .locator(`${KIND_CONTENT} ${KIND_ITEM}`)
    .evaluateAll((items) =>
      items.map((item) =>
        (item.getAttribute('data-testid') ?? '').replace('enum-picker-item-kind-', ''),
      ),
    )
}

async function openKindPicker(page: Page, modal: Locator): Promise<Locator> {
  await paramRow(modal, 'kind').scrollIntoViewIfNeeded()
  await modal.locator(KIND_TRIGGER).click()
  const content = page.locator(KIND_CONTENT).first()
  await expect(content).toBeVisible()
  return content
}

/** Hover one row's (i) and read the single accessible copy of its tooltip. */
async function expectInfoBadge(page: Page, modal: Locator, row: Locator, id: string, text: string) {
  await row.scrollIntoViewIfNeeded()
  await row.locator('.cursor-help').hover()
  await waitForTooltipText(page, text, id, 5_000)
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  // Radix paints the wording twice; [role="tooltip"] is the single accessible copy.
  await expect(tooltip.locator('[role="tooltip"]'), id).toHaveText(text, { timeout: 5_000 })
  // Leave the badge so the next hover cannot race a tooltip that is still open.
  await modal.locator('h2').first().hover()
  await waitForTooltipClosed(page, id, 5_000)
  await expect(tooltip, id).toHaveCount(0)
}

test.describe('V-PLUGIN-K8S-07: K8s Delete config sheet', () => {
  test('DL-a: four groups in order; Advanced and Failure Handling open collapsed and expand on click', async ({
    page,
  }) => {
    const modal = await openDeleteConfig(page)
    await expect(modal.locator('h2').first()).toContainText('K8s Delete - Edit Config')

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // K8SREAD-10: the sheet opens on the rows an author has to fill in.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Resource')).toHaveAttribute('aria-expanded', 'true')
    for (const group of COLLAPSED_GROUPS) {
      await expect(groupHeader(modal, group)).toHaveAttribute('aria-expanded', 'false')
      // A folded card renders neither its rows nor its footer.
      expect(await groupRowIds(modal, group), group).toEqual([])
      await expect(groupFooter(modal, group), group).toHaveCount(0)
    }
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)
    await expect(paramRow(modal, 'namespace')).toHaveCount(0)
    await expect(paramRow(modal, 'on_error')).toHaveCount(0)

    expect(await groupRowIds(modal, 'Connection')).toEqual(CONNECTION_ROWS)
    expect(await groupRowIds(modal, 'Resource')).toEqual(SHEET_STATES[0].resource)

    for (const group of COLLAPSED_GROUPS) {
      await expandGroup(modal, group)
    }
    expect(await groupRowIds(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    expect(await groupRowIds(modal, 'Failure Handling')).toEqual(['on_error'])

    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(4)
    for (const [group, footer] of Object.entries(GROUP_FOOTERS)) {
      await expect(groupFooter(modal, group), group).toHaveText(footer)
    }

    await expectOnlyRequiredFlags(modal)
  })

  test('DL-b: every Resource Type and Delete by state renders its own Resource rows, and the sheet never grows a Field Selector, an All namespaces or an Output Format row', async ({
    page,
  }) => {
    const modal = await openDeleteConfig(page)
    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')

    for (const group of FOREIGN_GROUPS) {
      await expect(groupHeader(modal, group), group).toHaveCount(0)
    }

    for (const state of SHEET_STATES) {
      await test.step(`${state.id}: Resource Type ${state.resourceType}, Delete by ${state.deleteBy}`, async () => {
        await applyState(page, modal, state)

        expect(await groupRowIds(modal, 'Resource'), `${state.id} Resource rows`).toEqual(
          state.resource,
        )
        expect(await groupRowIds(modal, 'Connection'), `${state.id} Connection rows`).toEqual(
          CONNECTION_ROWS,
        )
        expect(await groupRowIds(modal, 'Advanced'), `${state.id} Advanced rows`).toEqual(
          ADVANCED_ROWS,
        )
        expect(
          await groupRowIds(modal, 'Failure Handling'),
          `${state.id} Failure Handling rows`,
        ).toEqual(['on_error'])

        // K8SWRITE-5: no Field Selector on a delete, and no list-mode rows at all.
        for (const absent of ABSENT_ROWS) {
          await expect(paramRow(modal, absent), `${state.id} ${absent}`).toHaveCount(0)
        }

        expect(await visibleRowIds(modal), `${state.id} whole sheet`).toEqual([
          ...CONNECTION_ROWS,
          ...state.resource,
          ...ADVANCED_ROWS,
          'on_error',
        ])
      })
    }
  })

  test('DL-c: every row label, and the required markers following the mode', async ({ page }) => {
    const modal = await openDeleteConfig(page)
    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')

    for (const state of SHEET_STATES) {
      await test.step(`${state.id}: labels and required markers`, async () => {
        await applyState(page, modal, state)
        const ids = await visibleRowIds(modal)

        const starred: string[] = []
        for (const name of ids) {
          expect(await rowLabel(modal, name), `${state.id} ${name} label`).toBe(ROW_LABELS[name])
          const marks = await paramRow(modal, name)
            .locator('td:nth-child(2) span.text-destructive')
            .count()
          if (marks > 0) starred.push(name)
        }

        expect(starred, `${state.id} rows carrying the required marker`).toEqual(state.required)
      })
    }
  })

  test('DL-d: Resource Type swaps Kind between the picker and a plain text row, and both kinds survive the round trip', async ({
    page,
  }) => {
    const modal = await openDeleteConfig(page)

    // K8SREAD-2: Default renders the grouped picker, Custom a plain string row.
    await expect(modal.locator(KIND_TRIGGER)).toHaveCount(1)
    await expect(modal.locator(KIND_TRIGGER)).toHaveText(KIND_AT_CREATION)
    await expect(paramRow(modal, 'kind_custom')).toHaveCount(0)

    const content = await openKindPicker(page, modal)
    await content.locator(`[data-testid="enum-picker-item-kind-${PICKED_KIND}"]`).click()
    await expect(page.locator(KIND_CONTENT)).toHaveCount(0)
    await expect(modal.locator(KIND_TRIGGER)).toHaveText(PICKED_KIND)

    await pickEnum(page, modal, 'resource_type', 'Custom')
    await expect(modal.locator(KIND_TRIGGER)).toHaveCount(0)
    await expect(paramRow(modal, 'kind')).toHaveCount(0)

    const custom = paramRow(modal, 'kind_custom')
    await expect(custom).toBeVisible()
    await expect(custom.locator('td').nth(1)).toContainText('Kind')
    await expect(custom.locator('td:nth-child(2) span.text-destructive')).toHaveCount(1)
    // A plain string row: no select trigger, no chevron, and it takes an expression.
    await expect(custom.getByRole('combobox')).toHaveCount(0)
    await expect(custom.locator('svg.lucide-chevron-down')).toHaveCount(0)
    await expect(custom.locator('[data-testid="expression-toggle"]')).toHaveCount(1)

    await setStringRow(page, modal, 'kind_custom', CUSTOM_KIND)
    await expectStringParamPreview(modal, 'kind_custom', CUSTOM_KIND)

    await pickEnum(page, modal, 'resource_type', 'Default')
    await expect(paramRow(modal, 'kind_custom')).toHaveCount(0)
    await expect(modal.locator(KIND_TRIGGER)).toHaveText(PICKED_KIND)

    await pickEnum(page, modal, 'resource_type', 'Custom')
    await expectStringParamPreview(modal, 'kind_custom', CUSTOM_KIND)
  })

  test('DL-e: the Kind picker bands, ordering and short names; Escape closes the picker and leaves the sheet open', async ({
    page,
  }) => {
    const modal = await openDeleteConfig(page)
    const content = await openKindPicker(page, modal)

    // FIELD-8: the Kind written at creation carries the check, and only it.
    await expect(content.locator('[data-testid="enum-picker-check-kind"]')).toHaveCount(1)
    await expect(
      content.locator(`[data-testid="enum-picker-item-kind-${KIND_AT_CREATION}"] [data-testid="enum-picker-check-kind"]`),
    ).toHaveCount(1)

    const bands = await content
      .locator('[data-testid^="enum-picker-group-kind-"]')
      .evaluateAll((els) =>
        els.map((el) =>
          (el.getAttribute('data-testid') ?? '').replace('enum-picker-group-kind-', ''),
        ),
      )
    expect(bands).toEqual(KIND_BANDS)
    await expect(content.locator(KIND_ITEM)).toHaveCount(KIND_COUNT)

    // K8SREAD-5: alphabetical inside each band, so CronJob leads the whole list.
    for (const heading of bands) {
      const kinds = await content
        .locator(`[data-testid="enum-picker-group-kind-${heading}"] ${KIND_ITEM}`)
        .evaluateAll((els) =>
          els.map((el) =>
            (el.getAttribute('data-testid') ?? '').replace('enum-picker-item-kind-', ''),
          ),
        )
      expect(kinds, heading).toEqual([...kinds].sort((a, b) => a.localeCompare(b)))
    }
    expect((await kindItemIds(page))[0]).toBe('CronJob')

    // K8SREAD-4: the short name is inline to the right; a kind without one is plain.
    const deployment = content.locator('[data-testid="enum-picker-item-kind-Deployment"]')
    const deploymentSpans = deployment.locator('span.items-baseline > span')
    await expect(deploymentSpans).toHaveCount(2)
    await expect(deploymentSpans.nth(0)).toHaveText('Deployment')
    await expect(deploymentSpans.nth(1)).toHaveText('deploy')

    const job = content.locator('[data-testid="enum-picker-item-kind-Job"]')
    await expect(job.locator('span.items-baseline')).toHaveCount(0)
    await expect(job).toHaveText('Job')

    // "netpol" is not a substring of the label, so only the short name can match it.
    await page.locator(KIND_SEARCH).fill('netpol')
    await expect(content.locator(KIND_ITEM)).toHaveCount(1)
    expect(await kindItemIds(page)).toEqual(['NetworkPolicy'])

    await page.locator(KIND_SEARCH).fill('zzzz')
    await expect(content.locator(KIND_ITEM)).toHaveCount(0)
    await expect(content.locator('[data-testid="enum-picker-empty-kind"]')).toHaveText(
      'No matching options',
    )

    await page.keyboard.press('Escape')
    await expect(page.locator(KIND_CONTENT)).toHaveCount(0)
    await expect(modal).toBeVisible()
    await expect(modal.locator(KIND_TRIGGER)).toHaveText(KIND_AT_CREATION)
  })

  test('DL-f: Delete by swaps Name for Label Selector and takes Ignore not found with it; the typed values survive but the tick does not', async ({
    page,
  }) => {
    const modal = await openDeleteConfig(page)

    await expect(paramRow(modal, 'name')).toBeVisible()
    await expect(paramRow(modal, 'ignore_not_found')).toBeVisible()
    await expect(paramRow(modal, 'label_selector')).toHaveCount(0)

    await setStringRow(page, modal, 'name', TYPED_NAME)
    await setCheckbox(modal, 'ignore_not_found', true)

    // K8SWRITE-5: Ignore not found is a Name-mode row, so Selector drops it.
    await pickEnum(page, modal, 'delete_by', 'Selector')
    await expect(paramRow(modal, 'name')).toHaveCount(0)
    await expect(paramRow(modal, 'ignore_not_found')).toHaveCount(0)
    await expect(paramRow(modal, 'label_selector')).toBeVisible()

    await setStringRow(page, modal, 'label_selector', TYPED_SELECTOR)

    await pickEnum(page, modal, 'delete_by', 'Name')
    await expect(paramRow(modal, 'label_selector')).toHaveCount(0)
    await expectStringParamPreview(modal, 'name', TYPED_NAME)
    // The tick is deliberately not retained: a stale one turns a failure into a pass.
    await expect(checkbox(modal, 'ignore_not_found')).toHaveAttribute('data-state', 'unchecked')

    await pickEnum(page, modal, 'delete_by', 'Selector')
    await expectStringParamPreview(modal, 'label_selector', TYPED_SELECTOR)
  })

  test('DL-g: every enum option list in order; Cascade holds each value; Grace Period opens empty and the two Booleans open on their defaults', async ({
    page,
  }) => {
    const modal = await openDeleteConfig(page)
    await expandGroup(modal, 'Failure Handling')

    for (const enumRow of ENUM_ROWS) {
      await test.step(`DL-g/${enumRow.name}: option list`, async () => {
        const trigger = paramRow(modal, enumRow.name).locator('button[role="combobox"]')
        await trigger.scrollIntoViewIfNeeded()
        await expect(trigger, enumRow.name).toHaveText(enumRow.opensOn)

        await trigger.click()
        const options = page.getByRole('option')
        await expect(options, enumRow.name).toHaveCount(enumRow.options.length)
        for (const [index, label] of enumRow.options.entries()) {
          await expect(options.nth(index), `${enumRow.name} option ${index}`).toHaveText(label)
        }
        await page.keyboard.press('Escape')
        await expect(page.locator('[role="listbox"]')).toHaveCount(0)
        await expect(trigger, enumRow.name).toHaveText(enumRow.opensOn)
      })
    }

    // K8SWRITE-5: Cascade changes what the cluster does, never what the sheet shows.
    for (const value of ['Foreground', 'Orphan', 'Background']) {
      await pickEnum(page, modal, 'cascade', value)
      expect(await groupRowIds(modal, 'Resource'), `cascade ${value}`).toEqual(
        SHEET_STATES[0].resource,
      )
    }

    // FIELD-2: Timeout shows its default in gray; Grace Period declares none.
    await expectGrayDefault(modal, 'timeout', '30')
    const grace = modal.locator('[data-testid="param-input-grace_period_seconds"]')
    await expect(grace).toHaveValue('')
    await expect(grace).not.toHaveAttribute('placeholder')
    await expect(paramRow(modal, 'grace_period_seconds').locator('td:nth-child(3)')).toHaveText(
      /^integer$/i,
    )

    await expect(checkbox(modal, 'ignore_not_found')).toHaveAttribute('data-state', 'unchecked')
    await expect(checkbox(modal, 'wait_until_gone')).toHaveAttribute('data-state', 'checked')
    for (const name of ['ignore_not_found', 'wait_until_gone']) {
      await expect(paramRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(/^boolean$/i)
    }
  })

  test('DL-h: the rows that select a mode take no expression, the rows that name the object do, and so do both Booleans', async ({
    page,
  }) => {
    const modal = await openDeleteConfig(page)
    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')

    const censusCases = [
      { state: SHEET_STATES[0], expected: EXPRESSION_ROWS_DEFAULT_NAME },
      { state: SHEET_STATES[3], expected: EXPRESSION_ROWS_CUSTOM_SELECTOR },
    ]

    for (const { state, expected } of censusCases) {
      await test.step(`${state.id}: expression toggle census`, async () => {
        await applyState(page, modal, state)
        const ids = await visibleRowIds(modal)

        const toggled: string[] = []
        for (const name of ids) {
          // The positive count keeps a renamed row from passing the sweep vacuously.
          await expect(paramRow(modal, name), `${state.id} ${name}`).toHaveCount(1)
          if (
            (await paramRow(modal, name).locator('[data-testid="expression-toggle"]').count()) > 0
          ) {
            toggled.push(name)
          }
        }

        expect(toggled, `${state.id} rows offering the expression toggle`).toEqual(expected)
        expect(
          ids.filter((name) => !toggled.includes(name)),
          `${state.id} rows refusing the expression toggle`,
        ).toEqual(NO_EXPRESSION_ROWS)
      })
    }

    // Both Delete Booleans keep the toggle: neither gates another row's visibility.
    await applyState(page, modal, SHEET_STATES[0])
    for (const name of ['ignore_not_found', 'wait_until_gone']) {
      await expect(paramRow(modal, name), name).toHaveCount(1)
      await expect(
        paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
        name,
      ).toBeVisible()
    }
  })

  test('DL-i: every input row leads with the info badge and its wording is exact', async ({
    page,
  }) => {
    // Sixteen rows behind a hover delay each, plus two mode switches.
    test.setTimeout(90_000)

    const modal = await openDeleteConfig(page)
    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')

    const defaultRows = await visibleRowIds(modal)
    for (const name of defaultRows) {
      await expect(
        paramRow(modal, name).locator('td').first().locator('svg'),
        `${name} info badge`,
      ).toBeVisible()
      await expectInfoBadge(page, modal, paramRow(modal, name), name, ROW_INFO[name])
    }

    // The Custom Kind row states that a kind the cluster does not serve fails the block.
    await pickEnum(page, modal, 'resource_type', 'Custom')
    await expectInfoBadge(
      page,
      modal,
      paramRow(modal, 'kind_custom'),
      'kind_custom',
      ROW_INFO['kind_custom'],
    )

    await pickEnum(page, modal, 'delete_by', 'Selector')
    await expectInfoBadge(
      page,
      modal,
      paramRow(modal, 'label_selector'),
      'label_selector',
      ROW_INFO['label_selector'],
    )
  })

  test('DL-j: four outputs led by Summary, six under Record and continue, and four again on the way back', async ({
    page,
  }) => {
    // Six output badges behind a hover delay each, plus two On error switches.
    test.setTimeout(60_000)

    const modal = await openDeleteConfig(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUT_ROWS_FAIL.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUT_ROWS_FAIL)

    for (const name of OUTPUT_ROWS_FAIL) {
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(
        OUTPUT_LABELS[name],
      )
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(
        new RegExp(`^${OUTPUT_TYPES[name]}$`, 'i'),
      )
      await expectInfoBadge(page, modal, outputRow(modal, name), name, OUTPUT_INFO[name])
    }

    // K8SWRITE-8: Error and Reason can only be filled under Record and continue.
    await expandGroup(modal, 'Failure Handling')
    await pickEnum(page, modal, 'on_error', 'Record and continue')

    await expect(outputs).toHaveCount(OUTPUT_ROWS_RECORD.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUT_ROWS_RECORD)
    for (const name of ['error', 'reason']) {
      await expect(outputRow(modal, name).locator('td:nth-child(2)'), name).toHaveText(
        OUTPUT_LABELS[name],
      )
      await expect(outputRow(modal, name).locator('td:nth-child(3)'), name).toHaveText(
        new RegExp(`^${OUTPUT_TYPES[name]}$`, 'i'),
      )
      await expectInfoBadge(page, modal, outputRow(modal, name), name, OUTPUT_INFO[name])
    }

    await pickEnum(page, modal, 'on_error', 'Fail the block')
    await expect(outputs).toHaveCount(OUTPUT_ROWS_FAIL.length)
    expect(await outputRowIds(modal)).toEqual(OUTPUT_ROWS_FAIL)
    for (const name of ['error', 'reason']) {
      await expect(outputRow(modal, name), name).toHaveCount(0)
    }
  })
})
