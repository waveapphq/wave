/**
 * V-PLUGIN-K8S-05: K8s Top config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SREAD-8, K8SREAD-9, K8SREAD-10, K8SREAD-12, K8SREAD-14,
 *                   K8SREAD-17
 *
 * Criterion ids follow v-plugin-k8s-01's letter convention (K-a..K-k there),
 * namespaced TOP-* here so they never collide with the K8s Top option rows.
 *
 * Pass Criteria:
 *   TOP-a  four groups in order Connection / Measurement / Advanced / Failure
 *          Handling; Advanced and Failure Handling open COLLAPSED, rendering
 *          neither their rows nor their footer, and expand on click
 *   TOP-b  the Advanced footer keeps ONE static wording in both Measure modes
 *   TOP-c  the six Measure x Select by combinations each render their own
 *          Measurement and Advanced row sets
 *   TOP-d  Measure Nodes removes Include containers and both namespace rows;
 *          Pods brings them back with their values intact
 *   TOP-e  the sheet opens on Select by All; the All namespaces tick is absent
 *          in Name mode, present in All and Selector, and leaves no stale value
 *          behind when Name hides it
 *   TOP-f  three outputs in order, unchanged by a Measure switch; Usage is
 *          typed table (K8SREAD-17), and Error and Reason appear only under
 *          Record and continue (K8SREAD-14)
 *   TOP-g  the Failure Handling info badge carries the metrics-API wording and
 *          On error defaults to Fail the block
 *   TOP-h  required markers, an info badge on every row, expression-toggle policy
 *   TOP-i  a restored draft whose bound Usage variable is still typed array
 *          comes back with the variable retyped to table and the Block carrying
 *          no misconfiguration badge
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import {
  dragPaletteItemToCanvas,
  stubSessionRecovery,
  waitForCanvasLoad,
} from '../../helpers/canvas'
import { k8sReadNode } from '../../helpers/k8s-nodes'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { expectOnlyRequiredFlags } from '../../helpers/config-sheet'

const GROUP_ORDER = ['Connection', 'Measurement', 'Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Measurement': 'Pods or nodes, and which ones to measure',
  'Advanced':
    'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const ADVANCED_FOOTER = GROUP_FOOTERS['Advanced']

const ON_ERROR_INFO =
  'Fail the block, or record the outcome and let the test continue. A cluster with no metrics API fails the block either way.'

const OUTPUT_ROWS = ['usage', 'count', 'success']
const OUTPUT_ROWS_RECORD = ['usage', 'count', 'success', 'error', 'reason']

const DRAFT_STORAGE_KEY = 'wave-workbench-draft'
const DRAFT_NODE_ID = 'k8s-top-draft'
const USAGE_VAR = 'top_usage'
const USAGE_VAR_ID = 'var-top-usage'
/** The complaint an array-typed variable bound to Usage raises (K8SREAD-17). */
const STALE_BINDING_ISSUE = `Output 'usage' (type table) cannot bind to variable '${USAGE_VAR}' (type array)`

/** Rows visible on a default sheet once both folded groups are open, in DOM order. */
const DEFAULT_ROWS = [
  'session',
  'timeout',
  'scope',
  'select_by',
  'include_containers',
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]
const REQUIRED_ROWS = ['session', 'scope', 'select_by']
const EXPRESSION_ROWS = [
  'session',
  'timeout',
  'include_containers',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
]

type MeasureLabel = 'Pods' | 'Nodes'
type SelectByLabel = 'All' | 'Name' | 'Selector'

interface SheetCase {
  id: string
  scope: MeasureLabel
  selectBy: SelectByLabel
  measurement: string[]
  advanced: string[]
}

/** The checklist, in code: every Measure x Select by pair and the rows it owns. */
const SHEET_CASES: SheetCase[] = [
  {
    id: 'TOP-c1',
    scope: 'Pods',
    selectBy: 'Name',
    measurement: ['scope', 'select_by', 'name', 'include_containers'],
    advanced: ['namespace', 'impersonate_user', 'impersonate_groups'],
  },
  {
    id: 'TOP-c2',
    scope: 'Pods',
    selectBy: 'Selector',
    measurement: ['scope', 'select_by', 'label_selector', 'include_containers'],
    advanced: ['all_namespaces', 'namespace', 'impersonate_user', 'impersonate_groups'],
  },
  {
    id: 'TOP-c3',
    scope: 'Pods',
    selectBy: 'All',
    measurement: ['scope', 'select_by', 'include_containers'],
    advanced: ['all_namespaces', 'namespace', 'impersonate_user', 'impersonate_groups'],
  },
  {
    id: 'TOP-c4',
    scope: 'Nodes',
    selectBy: 'Name',
    measurement: ['scope', 'select_by', 'name'],
    advanced: ['impersonate_user', 'impersonate_groups'],
  },
  {
    id: 'TOP-c5',
    scope: 'Nodes',
    selectBy: 'Selector',
    measurement: ['scope', 'select_by', 'label_selector'],
    advanced: ['impersonate_user', 'impersonate_groups'],
  },
  {
    id: 'TOP-c6',
    scope: 'Nodes',
    selectBy: 'All',
    measurement: ['scope', 'select_by'],
    advanced: ['impersonate_user', 'impersonate_groups'],
  },
]

async function openTopConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-top' },
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

/** A canvas carrying a K8s Top Block whose bound Usage variable is typed array. */
function staleUsageDraft(): Record<string, unknown> {
  return {
    nodes: [
      k8sReadNode({
        id: DRAFT_NODE_ID,
        elementType: 'k8s-top',
        values: { session: 'k8s-session', scope: 'pod', select_by: 'all', on_error: 'fail' },
        outputBindings: { usage: USAGE_VAR },
      }),
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    testId: null,
    testName: null,
    isDirty: true,
    variables: [{ id: USAGE_VAR_ID, name: USAGE_VAR, type: 'array', value: [] }],
  }
}

/** Seed the workbench draft, then load the canvas from it. */
async function restoreDraft(page: Page, draft: Record<string, unknown>): Promise<void> {
  await page.goto('/tests')
  await page.evaluate(() => localStorage.clear())
  // A leftover workbench session restores its own canvas over the draft.
  await stubSessionRecovery(page)
  await page.evaluate(
    ([key, payload]) => localStorage.setItem(key, payload),
    [DRAFT_STORAGE_KEY, JSON.stringify(draft)] as const,
  )
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

/** Open the Variable Manager panel. Idempotent. */
async function expandVariableManager(page: Page): Promise<Locator> {
  const panel = page.locator('[data-testid="variable-manager"]')
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
  }
  await expect(panel).toHaveAttribute('data-state', 'expanded')
  return panel
}

const paramRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-row-${name}"]`)

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
    .evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')))
}

/** Output row ids, in DOM order. */
function outputIds(modal: Locator): Promise<string[]> {
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

async function setCheckbox(modal: Locator, name: string, on: boolean) {
  const box = checkbox(modal, name)
  await box.scrollIntoViewIfNeeded()
  await expect(box).toBeVisible()
  const want = on ? 'checked' : 'unchecked'
  if ((await box.getAttribute('data-state')) !== want) await box.click()
  await expect(box).toHaveAttribute('data-state', want)
}

test.describe('V-PLUGIN-K8S-05: K8s Top config sheet', () => {
  test('TOP-a: four groups in order; Advanced and Failure Handling open collapsed and expand on click', async ({
    page,
  }) => {
    const modal = await openTopConfig(page)

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // K8SREAD-8/10: the sheet opens on the rows an author has to fill in.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Measurement')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Advanced')).toHaveAttribute('aria-expanded', 'false')
    await expect(groupHeader(modal, 'Failure Handling')).toHaveAttribute('aria-expanded', 'false')

    // A collapsed card renders neither its rows nor its footer.
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)
    expect(await groupRowIds(modal, 'Advanced')).toEqual([])
    expect(await groupRowIds(modal, 'Failure Handling')).toEqual([])
    await expect(paramRow(modal, 'on_error')).toHaveCount(0)
    await expect(paramRow(modal, 'impersonate_user')).toHaveCount(0)
    await expect(paramRow(modal, 'namespace')).toHaveCount(0)

    expect(await groupRowIds(modal, 'Connection')).toEqual(['session', 'timeout'])
    // `kubectl top pod` takes no arguments, so the sheet opens on All and there
    // is no Name row to fill.
    expect(await groupRowIds(modal, 'Measurement')).toEqual([
      'scope',
      'select_by',
      'include_containers',
    ])

    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')

    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(4)
    expect(await groupRowIds(modal, 'Failure Handling')).toEqual(['on_error'])
    for (const [group, footer] of Object.entries(GROUP_FOOTERS)) {
      await expect(groupFooter(modal, group)).toHaveText(footer)
    }
  })

  test('TOP-b: the Advanced footer keeps one static wording in both Measure modes', async ({
    page,
  }) => {
    const modal = await openTopConfig(page)
    await expandGroup(modal, 'Advanced')

    await expect(groupFooter(modal, 'Advanced')).toHaveText(ADVANCED_FOOTER)

    await pickEnum(page, modal, 'scope', 'Nodes')
    // The mode really changed: Nodes leaves the impersonation pair alone in Advanced.
    expect(await groupRowIds(modal, 'Advanced')).toEqual(['impersonate_user', 'impersonate_groups'])
    await expect(groupFooter(modal, 'Advanced')).toHaveText(ADVANCED_FOOTER)

    await pickEnum(page, modal, 'scope', 'Pods')
    expect(await groupRowIds(modal, 'Advanced')).toEqual([
      'all_namespaces',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ])
    await expect(groupFooter(modal, 'Advanced')).toHaveText(ADVANCED_FOOTER)
  })

  test('TOP-c: every Measure and Select by combination renders its own Measurement and Advanced rows', async ({
    page,
  }) => {
    const modal = await openTopConfig(page)
    await expandGroup(modal, 'Advanced')

    for (const sheetCase of SHEET_CASES) {
      await test.step(`${sheetCase.id}: Measure ${sheetCase.scope}, Select by ${sheetCase.selectBy}`, async () => {
        await pickEnum(page, modal, 'scope', sheetCase.scope)
        await pickEnum(page, modal, 'select_by', sheetCase.selectBy)

        expect(
          await groupRowIds(modal, 'Measurement'),
          `${sheetCase.id} Measurement rows`,
        ).toEqual(sheetCase.measurement)
        expect(await groupRowIds(modal, 'Advanced'), `${sheetCase.id} Advanced rows`).toEqual(
          sheetCase.advanced,
        )
      })
    }
  })

  test('TOP-d: Measure Nodes removes Include containers and both namespace rows, and Pods restores them with their values', async ({
    page,
  }) => {
    const modal = await openTopConfig(page)
    await expandGroup(modal, 'Advanced')

    // Selector mode carries both namespace rows: All namespaces and Namespace.
    await pickEnum(page, modal, 'select_by', 'Selector')
    await setCheckbox(modal, 'include_containers', true)
    expect(await groupRowIds(modal, 'Advanced')).toEqual([
      'all_namespaces',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ])

    await pickEnum(page, modal, 'scope', 'Nodes')
    await expect(paramRow(modal, 'include_containers')).toHaveCount(0)
    for (const row of ['all_namespaces', 'namespace']) {
      await expect(paramRow(modal, row)).toHaveCount(0)
    }
    expect(await groupRowIds(modal, 'Measurement')).toEqual([
      'scope',
      'select_by',
      'label_selector',
    ])
    expect(await groupRowIds(modal, 'Advanced')).toEqual(['impersonate_user', 'impersonate_groups'])

    // Back to Pods: the rows return and the drafts survived the round trip.
    await pickEnum(page, modal, 'scope', 'Pods')
    expect(await groupRowIds(modal, 'Advanced')).toEqual([
      'all_namespaces',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ])
    await expect(checkbox(modal, 'include_containers')).toHaveAttribute('data-state', 'checked')
  })

  test('TOP-e: All namespaces is absent in Name mode, present in All and Selector, and leaves no stale value', async ({
    page,
  }) => {
    const modal = await openTopConfig(page)
    await expandGroup(modal, 'Advanced')

    // All is the default Select by, and it shows the tick.
    await expect(paramRow(modal, 'select_by').locator('button[role="combobox"]')).toHaveText('All')
    await expect(paramRow(modal, 'all_namespaces')).toBeVisible()
    await expect(paramRow(modal, 'name')).toHaveCount(0)

    // Name is the mode that hides the tick, the way Get does.
    await pickEnum(page, modal, 'select_by', 'Name')
    await expect(paramRow(modal, 'all_namespaces')).toHaveCount(0)

    await pickEnum(page, modal, 'select_by', 'All')
    await expect(paramRow(modal, 'all_namespaces')).toBeVisible()

    await pickEnum(page, modal, 'select_by', 'Selector')
    await expect(paramRow(modal, 'all_namespaces')).toBeVisible()
    await setCheckbox(modal, 'all_namespaces', true)
    expect(await groupRowIds(modal, 'Advanced')).toEqual([
      'all_namespaces',
      'impersonate_user',
      'impersonate_groups',
    ])

    // Name hides the tick AND drops what it held, so nothing stale rides along.
    await pickEnum(page, modal, 'select_by', 'Name')
    await expect(paramRow(modal, 'all_namespaces')).toHaveCount(0)
    expect(await groupRowIds(modal, 'Advanced')).toEqual([
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ])

    await pickEnum(page, modal, 'select_by', 'Selector')
    await expect(checkbox(modal, 'all_namespaces')).toHaveAttribute('data-state', 'unchecked')
  })

  test('TOP-f: three outputs in order, unchanged by a Measure switch, with Usage typed table', async ({
    page,
  }) => {
    const modal = await openTopConfig(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUT_ROWS.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ROWS)

    await expect(modal.locator('[data-testid="output-row-usage"]')).toContainText('Usage')
    await expect(modal.locator('[data-testid="output-row-count"]')).toContainText('Count')
    // K8SREAD-17: Usage is one table whose columns follow the measurement.
    await expect(
      modal.locator('[data-testid="output-row-usage"]').locator('td').nth(2),
    ).toHaveText(/table/i)
    await expect(
      modal.locator('[data-testid="output-row-count"]').locator('td').nth(2),
    ).toHaveText(/integer/i)

    // K8SREAD-9: a Measure switch never changes the census; only On error does.
    await pickEnum(page, modal, 'scope', 'Nodes')
    await expect(outputs).toHaveCount(OUTPUT_ROWS.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ROWS)

    // K8SREAD-14: Error and Reason exist only under Record and continue, and
    // Success is the exception that stays under both.
    await expandGroup(modal, 'Failure Handling')
    await pickEnum(page, modal, 'on_error', 'Record and continue')
    await expect(outputs).toHaveCount(OUTPUT_ROWS_RECORD.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ROWS_RECORD)

    await pickEnum(page, modal, 'on_error', 'Fail the block')
    await expect(outputs).toHaveCount(OUTPUT_ROWS.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ROWS)
  })

  test('TOP-g: the Failure Handling info badge carries the metrics-API wording and On error defaults to Fail the block', async ({
    page,
  }) => {
    const modal = await openTopConfig(page)

    // K8SREAD-10: the group opens collapsed, so the badge is behind a click.
    await expect(paramRow(modal, 'on_error')).toHaveCount(0)
    await expandGroup(modal, 'Failure Handling')

    const row = paramRow(modal, 'on_error')
    await expect(row.locator('button[role="combobox"]')).toHaveText('Fail the block')

    await row.locator('.cursor-help').hover()
    const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
    await expect(tooltip).toBeVisible({ timeout: 5_000 })
    // Radix paints the wording twice; [role="tooltip"] is the single accessible copy.
    await expect(tooltip.locator('[role="tooltip"]')).toHaveText(ON_ERROR_INFO)
  })

  test('TOP-h: required markers, an info badge on every row, and the expression-toggle policy', async ({
    page,
  }) => {
    const modal = await openTopConfig(page)
    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')

    const rows = modal.locator('[data-testid^="param-row-"]')
    const ids = await rows.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
    expect(ids).toEqual(DEFAULT_ROWS)

    const starred: string[] = []
    const badgeless: string[] = []
    const toggled: string[] = []
    for (const name of ids) {
      const row = paramRow(modal, name)
      if ((await row.getByText('*', { exact: true }).count()) > 0) starred.push(name)
      if ((await row.locator('td').first().locator('svg').count()) === 0) badgeless.push(name)
      if ((await row.locator('[data-testid="expression-toggle"]').count()) > 0) toggled.push(name)
    }

    expect(starred, 'rows carrying the required marker').toEqual(REQUIRED_ROWS)
    expect(badgeless, 'rows missing the (i) info badge').toEqual([])
    expect(toggled, 'rows offering the expression toggle').toEqual(EXPRESSION_ROWS)

    await expectOnlyRequiredFlags(modal)
  })

  test('TOP-i: a restored draft retypes its stale Usage binding to table and the Block carries no misconfiguration badge', async ({
    page,
  }) => {
    await restoreDraft(page, staleUsageDraft())

    const node = page.locator(`[data-testid="workflow-node-${DRAFT_NODE_ID}"]`)
    await expect(node).toBeVisible({ timeout: 20_000 })

    // K8SREAD-17: restoring a canvas repairs a bound variable whose type the
    // Block no longer declares, so the binding stays valid.
    await expect(page.locator('[data-testid="node-validation-alert"]')).toHaveCount(0)
    await expect(page.getByText(STALE_BINDING_ISSUE)).toHaveCount(0)

    await expandVariableManager(page)
    await expect(page.locator(`[data-testid="variable-name-${USAGE_VAR_ID}"]`)).toHaveText(
      USAGE_VAR,
    )
    await expect(page.locator(`[data-testid="type-badge-${USAGE_VAR_ID}"]`)).toHaveText('table')
  })
})
