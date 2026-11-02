/**
 * V-PLUGIN-K8S-03: K8s Events config sheet
 *
 * Phase: no-data (parallel) - palette drag-drop only, no backend data needed.
 * Runs under both dark and light projects (theme-agnostic DOM assertions).
 * REQ: REQ-3.3.5.4, REQ-3.4.1.5, REQ-5.1.1, REQ-3.1.3.14
 * Design Decisions: K8SREAD-2, K8SREAD-4, K8SREAD-5, K8SREAD-6, K8SREAD-8,
 *                   K8SREAD-9, K8SREAD-10, K8SREAD-11, K8SREAD-12, K8SREAD-14,
 *                   K8SREAD-15
 *
 * Pass Criteria:
 *   EV-a  the four group cards render in order Connection / Events / Advanced /
 *         Failure Handling, each expanded card carrying its exact footer note
 *   EV-b  Advanced and Failure Handling open COLLAPSED (K8SREAD-8, K8SREAD-10):
 *         no rows and no footer until clicked, both expand on click, and
 *         Failure Handling then holds On error only, defaulting to Fail the block
 *   EV-c  Scope to object gates Object Type, Object Kind and Object Name;
 *         Object Kind and Object Name are the two required object rows and
 *         K8s Session is the only other required input
 *   EV-d  the Events group holds the filter rows in schema order with Output
 *         Format last
 *   EV-e  every input row leads with the (i) info badge; the expression toggle
 *         is present on Event Type and Namespace and absent on every enum and
 *         boolean that drives the sheet
 *   EV-f  Namespace is on the sheet from the start with no tick above it;
 *         Advanced puts All namespaces above it and hides it while ticked,
 *         restoring it with its value when unticked
 *   EV-g  three output rows on a default sheet, with Error and Reason
 *         appearing only under Record and continue (K8SREAD-14)
 *   EV-h  the Type cell beside Result follows Output Format: Array gives
 *         Array, Table gives Table, JSON and YAML give String (K8SREAD-6)
 *   EV-i  Object Type is a Default / Custom selector with the grouped Kind
 *         picker on the row below it (K8SREAD-11)
 *   EV-j  the Object Kind picker carries the five tinted band headings in
 *         order, 23 kinds alphabetical within each band, and the kubectl short
 *         names inline to the right of the label
 *   EV-k  the picker's search box matches on the label or the short name, and
 *         Escape closes the picker while leaving the config sheet open
 *   EV-l  Custom swaps the picker for a plain Object Kind text row and back
 *         again, and neither the picked kind nor the typed kind is lost
 *   EV-m  the Custom Object Kind row and the Result output carry their exact
 *         info-badge wording, and the Changelog carries the Output Format entry
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { expectStringParamPreview } from '../../helpers/param-config'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

const GROUP_ORDER = ['Connection', 'Events', 'Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Events': 'Which events to keep, and how they come back',
  'Advanced':
    'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const EVENTS_ROWS_UNSCOPED = [
  'scope_to_object',
  'event_type',
  'reason',
  'within_seconds',
  'max_events',
  'output_format',
]
const EVENTS_ROWS_SCOPED = [
  'scope_to_object',
  'object_type',
  'object_kind',
  'object_name',
  'event_type',
  'reason',
  'within_seconds',
  'max_events',
  'output_format',
]
const OBJECT_ROWS = ['object_type', 'object_kind', 'object_name']
const REQUIRED_ROWS = ['session', 'object_kind', 'object_name']

const ADVANCED_ROWS = ['all_namespaces', 'namespace', 'impersonate_user', 'impersonate_groups']
const ADVANCED_ROWS_ALL_NAMESPACES = ['all_namespaces', 'impersonate_user', 'impersonate_groups']

// K8SREAD-11 / the shared enum policy: the rows that steer the sheet take no
// expression, the one behavioral filter does.
const NO_EXPRESSION_ROWS = [
  'scope_to_object',
  'object_type',
  'output_format',
  'on_error',
  'all_namespaces',
]
const EXPRESSION_ROWS = ['event_type', 'namespace']

const OUTPUT_ROWS = ['result', 'count', 'success']
const OUTPUT_ROWS_RECORD = ['result', 'count', 'success', 'error', 'reason']

// K8SREAD-6: the declared type of Result follows Output Format.
const RESULT_TYPE_BY_FORMAT = [
  { format: 'Array', type: 'array' },
  { format: 'Table', type: 'table' },
  { format: 'JSON', type: 'string' },
  { format: 'YAML', type: 'string' },
  { format: 'Array', type: 'array' },
]

/** Exact info-badge wording of the Custom Object Kind row and the Result output. */
const OBJECT_KIND_CUSTOM_INFO =
  'Any name kubectl accepts for the kind: HorizontalPodAutoscaler, hpa or horizontalpodautoscalers. A kind this cluster does not serve fails the block.'
const RESULT_INFO =
  'The events that passed the filters, newest first. Its type follows Output Format: the parsed list for Array, a table for Table, text for JSON and YAML.'

/** The Output Format entry the in-app Changelog carries for 1.0.0. */
const CHANGELOG_OUTPUT_FORMAT = 'Output Format Array, Table, JSON or YAML'

// K8SREAD-5: fixed band order, alphabetical inside each band, 23 kinds total.
const KIND_GROUPS = ['Workloads', 'Networking', 'Config', 'Storage', 'Cluster']
const KIND_COUNT = 23

// "netpol" is NOT a substring of "networkpolicy", so that row can only match on
// the kubectl short name - which is what makes this leg prove the short-name
// search rather than the label search.
const SEARCH_CASES = [
  { query: 'netpol', items: ['NetworkPolicy'], groups: 1 },
  { query: 'po', items: ['Pod', 'Endpoints', 'NetworkPolicy'], groups: 2 },
]

const KIND_TRIGGER = '[data-testid="enum-picker-trigger-object_kind"]'
const KIND_CONTENT = '[data-testid="enum-picker-content-object_kind"]'
const KIND_SEARCH = '[data-testid="enum-picker-search-object_kind"]'

async function openEventsConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'k8s', testId: 'palette-item-k8s-events' },
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

const groupCard = (modal: Locator, group: string) =>
  modal.locator(`[data-testid="group-header-${group}"]`).locator('..')

const requiredStar = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('td:nth-child(2) span.text-destructive')

/** Param names inside one group card, in DOM order. */
function groupRowNames(modal: Locator, group: string): Promise<string[]> {
  return groupCard(modal, group)
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

function visibleRowNames(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

async function expandGroup(modal: Locator, group: string) {
  const header = modal.locator(`[data-testid="group-header-${group}"]`)
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

async function pickEnum(page: Page, modal: Locator, param: string, optionLabel: string) {
  await paramRow(modal, param).getByRole('combobox').scrollIntoViewIfNeeded()
  await paramRow(modal, param).getByRole('combobox').click()
  await page.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(page.locator('[role="listbox"]')).toHaveCount(0)
  await expect(paramRow(modal, param).getByRole('combobox')).toHaveText(optionLabel)
}

async function setCheckbox(modal: Locator, param: string, on: boolean) {
  const box = paramRow(modal, param).locator('button[role="checkbox"]')
  if (((await box.getAttribute('data-state')) === 'checked') !== on) await box.click()
  await expect(box).toHaveAttribute('data-state', on ? 'checked' : 'unchecked')
}

async function setStringValue(page: Page, modal: Locator, param: string, text: string) {
  await paramRow(modal, param).scrollIntoViewIfNeeded()
  await modal.locator(`[data-testid="param-expand-${param}"]`).click()
  const editor = page.locator('[data-testid="value-editor-sheet"]')
  await expect(editor).toBeVisible()
  await editor.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await editor.locator('[data-testid="value-editor-save-button"]').click()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).not.toBeVisible()
}

/** Output row ids, in DOM order. */
function outputIds(modal: Locator): Promise<string[]> {
  return modal
    .locator('[data-testid^="output-row-"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', '')),
    )
}

/** Hover a row's (i) badge and read the single accessible copy of its tooltip. */
async function expectInfoBadge(page: Page, row: Locator, text: string): Promise<void> {
  const badge = row.locator('.cursor-help')
  await badge.scrollIntoViewIfNeeded()
  await badge.hover()
  await waitForTooltipVisible(page, text, 5_000)
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  await expect(tooltip).toBeVisible({ timeout: 5_000 })
  // Radix paints the wording twice; [role="tooltip"] is the single accessible copy.
  await expect(tooltip.locator('[role="tooltip"]')).toHaveText(text)
  await page.mouse.move(0, 0)
  await waitForTooltipClosed(page, text, 5_000)
  await expect(tooltip).toHaveCount(0)
}

/** The Type cell of an output row (3rd column: info, name, type, secret, value). */
async function outputType(modal: Locator, name: string): Promise<string> {
  const raw = await modal.locator(`[data-testid="output-row-${name}"] td:nth-child(3)`).innerText()
  return raw.trim().toLowerCase()
}

async function openKindPicker(page: Page, modal: Locator): Promise<Locator> {
  await paramRow(modal, 'object_kind').scrollIntoViewIfNeeded()
  await modal.locator(KIND_TRIGGER).click()
  const content = page.locator(KIND_CONTENT)
  await expect(content).toBeVisible()
  return content
}

test.describe('V-PLUGIN-K8S-03: K8s Events config sheet', () => {
  test('EV-a/EV-b: four groups in order; Advanced and Failure Handling open collapsed with no rows and no footer, and expand on click', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // K8SREAD-8 / K8SREAD-10: the sheet opens on the rows an author has to
    // fill in, so only Connection and the verb group are expanded.
    await expect(modal.locator('[data-testid="group-header-Connection"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(modal.locator('[data-testid="group-header-Events"]')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    for (const group of COLLAPSED_GROUPS) {
      await expect(modal.locator(`[data-testid="group-header-${group}"]`)).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    }

    // A collapsed card renders neither its rows nor its footer.
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)
    for (const group of COLLAPSED_GROUPS) {
      await expect(modal.locator(`[data-testid="group-footer-${group}"]`)).toHaveCount(0)
      expect(await groupRowNames(modal, group)).toEqual([])
    }
    await expect(paramRow(modal, 'all_namespaces')).toHaveCount(0)
    await expect(paramRow(modal, 'on_error')).toHaveCount(0)

    await expect(modal.locator('[data-testid="group-footer-Connection"]')).toHaveText(
      GROUP_FOOTERS['Connection'],
    )
    await expect(modal.locator('[data-testid="group-footer-Events"]')).toHaveText(
      GROUP_FOOTERS['Events'],
    )

    // Both folds open on a click, and only then do their rows and notes exist.
    for (const group of COLLAPSED_GROUPS) {
      await expandGroup(modal, group)
      await expect(modal.locator(`[data-testid="group-footer-${group}"]`)).toHaveText(
        GROUP_FOOTERS[group],
      )
    }
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(4)
    expect(await groupRowNames(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    expect(await groupRowNames(modal, 'Failure Handling')).toEqual(['on_error'])
    await expect(paramRow(modal, 'on_error').getByRole('combobox')).toHaveText('Fail the block')
  })

  test('EV-c/EV-d: Scope to object gates the two required object rows; the Events group keeps the filter rows with Output Format last', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)

    // Unscoped: the object rows do not exist at all.
    expect(await groupRowNames(modal, 'Events')).toEqual(EVENTS_ROWS_UNSCOPED)
    for (const name of OBJECT_ROWS) {
      await expect(paramRow(modal, name)).toHaveCount(0)
    }
    expect(await requiredStar(modal, 'session').count()).toBe(1)

    await setCheckbox(modal, 'scope_to_object', true)
    const scoped = await groupRowNames(modal, 'Events')
    expect(scoped).toEqual(EVENTS_ROWS_SCOPED)
    expect(scoped.at(-1)).toBe('output_format')

    // K8SREAD-11: Object Kind and Object Name are the required pair; nothing
    // else on the sheet carries the marker.
    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')
    for (const name of await visibleRowNames(modal)) {
      expect(
        { row: name, stars: await requiredStar(modal, name).count() },
      ).toEqual({ row: name, stars: REQUIRED_ROWS.includes(name) ? 1 : 0 })
    }

    // Unticking takes the three rows away again.
    await setCheckbox(modal, 'scope_to_object', false)
    expect(await groupRowNames(modal, 'Events')).toEqual(EVENTS_ROWS_UNSCOPED)
  })

  test('EV-e: info badge on every input row; the expression toggle sits on Event Type and Namespace and on none of the sheet-driving rows', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)
    await setCheckbox(modal, 'scope_to_object', true)
    await expandGroup(modal, 'Advanced')
    await expandGroup(modal, 'Failure Handling')

    for (const name of await visibleRowNames(modal)) {
      await expect(paramRow(modal, name).locator('td').first().locator('svg')).toBeVisible()
    }

    for (const name of NO_EXPRESSION_ROWS) {
      await expect(paramRow(modal, name)).toHaveCount(1)
      await expect(paramRow(modal, name).locator('[data-testid="expression-toggle"]')).toHaveCount(0)
    }
    for (const name of EXPRESSION_ROWS) {
      await expect(paramRow(modal, name).locator('[data-testid="expression-toggle"]')).toBeVisible()
    }
  })

  test('EV-f: Advanced puts All namespaces above the Namespace row and hides it while ticked', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)
    await expandGroup(modal, 'Advanced')

    // Namespace is on the sheet from the start, optional, with no tick above it.
    expect(await groupRowNames(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    await expect(paramRow(modal, 'namespace')).toBeVisible()
    await expect(requiredStar(modal, 'namespace')).toHaveCount(0)
    await setStringValue(page, modal, 'namespace', 'wave-events')

    // K8SREAD-8: All namespaces and an explicit namespace are mutually exclusive.
    await setCheckbox(modal, 'all_namespaces', true)
    expect(await groupRowNames(modal, 'Advanced')).toEqual(ADVANCED_ROWS_ALL_NAMESPACES)
    await expect(paramRow(modal, 'namespace')).toHaveCount(0)

    // Unticking brings the row back with the value it was left holding.
    await setCheckbox(modal, 'all_namespaces', false)
    expect(await groupRowNames(modal, 'Advanced')).toEqual(ADVANCED_ROWS)
    await expectStringParamPreview(modal, 'namespace', 'wave-events')
  })

  test('EV-g/EV-h: three outputs on a default sheet, Error and Reason only under Record and continue, and the Result type follows Output Format', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUT_ROWS.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ROWS)
    await expect(modal.locator('[data-testid="output-row-result"]')).toContainText('Result')

    // K8SREAD-6: Array gives array on Events, Table gives table, JSON and YAML
    // give string. The last row returns to Array to prove the cell tracks both ways.
    for (const { format, type } of RESULT_TYPE_BY_FORMAT) {
      await pickEnum(page, modal, 'output_format', format)
      expect({ format, type: await outputType(modal, 'result') }).toEqual({ format, type })
      // K8SREAD-9: Output Format never changes the census; only On error does.
      await expect(outputs).toHaveCount(OUTPUT_ROWS.length)
    }

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

  test('EV-i: Object Type is a Default / Custom selector with the grouped Kind picker on the row below', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)
    await setCheckbox(modal, 'scope_to_object', true)

    const eventsRows = await groupRowNames(modal, 'Events')
    expect(eventsRows.indexOf('object_kind')).toBe(eventsRows.indexOf('object_type') + 1)

    // Object Type is the plain select, not a second searchable picker.
    await expect(paramRow(modal, 'object_type').getByRole('combobox')).toHaveText('Default')
    await expect(modal.locator('[data-testid="enum-picker-trigger-object_type"]')).toHaveCount(0)

    await paramRow(modal, 'object_type').getByRole('combobox').click()
    const options = page.getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(options.nth(0)).toHaveText('Default')
    await expect(options.nth(1)).toHaveText('Custom')
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="listbox"]')).toHaveCount(0)

    // K8SREAD-11: Default renders the same grouped searchable picker Get uses.
    await expect(modal.locator(KIND_TRIGGER)).toBeVisible()
    await expect(paramRow(modal, 'object_kind_custom')).toHaveCount(0)
  })

  test('EV-j: the Object Kind picker carries the five tinted band headings, 23 alphabetical kinds and the kubectl short names inline', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)
    await setCheckbox(modal, 'scope_to_object', true)
    const content = await openKindPicker(page, modal)

    const headings = await content
      .locator('[data-testid^="enum-picker-group-object_kind-"]')
      .evaluateAll((els) =>
        els.map((el) =>
          (el.getAttribute('data-testid') ?? '').replace('enum-picker-group-object_kind-', ''),
        ),
      )
    expect(headings).toEqual(KIND_GROUPS)

    // K8SREAD-5: each heading is a tinted band spanning the list width.
    const band = await content
      .locator('[data-testid="enum-picker-group-object_kind-Workloads"] [cmdk-group-heading]')
      .evaluate((el) => {
        const list = el.closest('[cmdk-list]') ?? el.parentElement
        const group = el.closest('[cmdk-group]')
        if (!list || !group) return null
        return {
          bg: getComputedStyle(el).backgroundColor,
          listBg: getComputedStyle(list).backgroundColor,
          width: el.getBoundingClientRect().width,
          groupWidth: group.getBoundingClientRect().width,
        }
      })
    expect(band).not.toBeNull()
    expect(band!.bg).not.toMatch(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)|transparent/)
    expect(band!.bg).not.toBe(band!.listBg)
    expect(band!.width).toBeGreaterThanOrEqual(band!.groupWidth - 2)

    await expect(content.locator('[data-testid^="enum-picker-item-object_kind-"]')).toHaveCount(
      KIND_COUNT,
    )
    for (const heading of KIND_GROUPS) {
      const kinds = await content
        .locator(
          `[data-testid="enum-picker-group-object_kind-${heading}"] [data-testid^="enum-picker-item-object_kind-"]`,
        )
        .evaluateAll((els) =>
          els.map((el) =>
            (el.getAttribute('data-testid') ?? '').replace('enum-picker-item-object_kind-', ''),
          ),
        )
      expect(kinds.length).toBeGreaterThan(0)
      expect(kinds).toEqual([...kinds].sort((a, b) => a.localeCompare(b)))
    }

    // K8SREAD-4: the short name is inline muted text to the right of the label
    // on the same row, and a kind without one renders plain.
    const deployment = content.locator('[data-testid="enum-picker-item-object_kind-Deployment"]')
    const spans = deployment.locator('span.items-baseline > span')
    await expect(spans).toHaveCount(2)
    await expect(spans.nth(0)).toHaveText('Deployment')
    await expect(spans.nth(1)).toHaveText('deploy')
    const labelBox = await spans.nth(0).boundingBox()
    const shortBox = await spans.nth(1).boundingBox()
    expect(shortBox!.x).toBeGreaterThan(labelBox!.x + labelBox!.width)
    expect(
      Math.abs(labelBox!.y + labelBox!.height - (shortBox!.y + shortBox!.height)),
    ).toBeLessThan(6)

    const job = content.locator('[data-testid="enum-picker-item-object_kind-Job"]')
    await expect(job.locator('span.items-baseline')).toHaveCount(0)
    await expect(job).toHaveText('Job')
  })

  test('EV-k: the picker search box matches on the label or the short name, and Escape closes it leaving the sheet open', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)
    await setCheckbox(modal, 'scope_to_object', true)
    const content = await openKindPicker(page, modal)

    const search = page.locator(KIND_SEARCH)
    await expect(search).toBeVisible()

    for (const { query, items, groups } of SEARCH_CASES) {
      await search.fill(query)
      const shown = await content
        .locator('[data-testid^="enum-picker-item-object_kind-"]')
        .evaluateAll((els) =>
          els.map((el) =>
            (el.getAttribute('data-testid') ?? '').replace('enum-picker-item-object_kind-', ''),
          ),
        )
      expect({ query, shown }).toEqual({ query, shown: items })
      await expect(content.locator('[data-testid^="enum-picker-group-object_kind-"]')).toHaveCount(
        groups,
      )
    }

    await search.fill('nothing-matches-this')
    await expect(content.locator('[data-testid="enum-picker-empty-object_kind"]')).toHaveText(
      'No matching options',
    )

    await page.keyboard.press('Escape')
    await expect(page.locator(KIND_CONTENT)).toHaveCount(0)
    await expect(modal).toBeVisible()
  })

  test('EV-l: Custom swaps the picker for a plain Object Kind row and back, keeping the picked kind and the typed kind', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)
    await setCheckbox(modal, 'scope_to_object', true)

    const content = await openKindPicker(page, modal)
    await content.locator('[data-testid="enum-picker-item-object_kind-Deployment"]').click()
    await expect(page.locator(KIND_CONTENT)).toHaveCount(0)
    await expect(modal.locator(KIND_TRIGGER)).toHaveText('Deployment')

    // K8SREAD-2: Custom replaces the picker with a plain required string field.
    await pickEnum(page, modal, 'object_type', 'Custom')
    await expect(modal.locator(KIND_TRIGGER)).toHaveCount(0)
    await expect(paramRow(modal, 'object_kind')).toHaveCount(0)
    const customRow = paramRow(modal, 'object_kind_custom')
    await expect(customRow).toBeVisible()
    await expect(customRow.locator('td').nth(1)).toContainText('Object Kind')
    await expect(requiredStar(modal, 'object_kind_custom')).toHaveCount(1)
    await expect(customRow.getByRole('combobox')).toHaveCount(0)
    await expect(customRow.locator('svg.lucide-chevron-down')).toHaveCount(0)

    await setStringValue(page, modal, 'object_kind_custom', 'VirtualService')
    await expectStringParamPreview(modal, 'object_kind_custom', 'VirtualService')

    // Back to Default: the picked kind survived the round trip.
    await pickEnum(page, modal, 'object_type', 'Default')
    await expect(paramRow(modal, 'object_kind_custom')).toHaveCount(0)
    await expect(modal.locator(KIND_TRIGGER)).toHaveText('Deployment')

    // And back to Custom: so did the typed kind.
    await pickEnum(page, modal, 'object_type', 'Custom')
    await expectStringParamPreview(modal, 'object_kind_custom', 'VirtualService')
  })

  test('EV-m: the Custom Object Kind row and the Result output carry their exact info-badge wording, and the Changelog carries the Output Format entry', async ({
    page,
  }) => {
    const modal = await openEventsConfig(page)

    // K8SREAD-15: the badge names the option the sheet actually offers.
    await expectInfoBadge(page, modal.locator('[data-testid="output-row-result"]'), RESULT_INFO)

    await setCheckbox(modal, 'scope_to_object', true)
    await pickEnum(page, modal, 'object_type', 'Custom')
    await expect(paramRow(modal, 'object_kind_custom')).toBeVisible()
    await expectInfoBadge(page, paramRow(modal, 'object_kind_custom'), OBJECT_KIND_CUSTOM_INFO)

    await modal.getByRole('button', { name: 'Changelog' }).click()
    const changelog = page.locator('[data-testid="changelog-scroll"]')
    await expect(changelog).toBeVisible()
    await expect(changelog).toContainText(CHANGELOG_OUTPUT_FORMAT)

    await page.keyboard.press('Escape')
    await expect(changelog).toHaveCount(0)
    await expect(modal).toBeVisible()
  })
})
