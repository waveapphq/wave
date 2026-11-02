/**
 * V-PLUGIN-K8S-02: K8s Get config sheet
 *
 * Phase: no-data (parallel) - seeds its own Test via POST /tests, no DB reset
 * and no cluster. Runs under both dark and light projects (theme-agnostic DOM
 * assertions).
 * REQ: REQ-3.1.3.14, REQ-5.1.1
 * Design Decisions: K8SREAD-5, K8SREAD-6, K8SREAD-8, K8SREAD-9, K8SREAD-10,
 *                   K8SREAD-12, K8SREAD-14, K8SREAD-15
 *
 * Criterion ids follow v-plugin-k8s-01's letter convention, namespaced to this
 * file so a failure names the row it broke.
 *
 * Pass Criteria:
 *   K2-a  four group cards render in order Connection / Resource / Advanced /
 *         Failure Handling, each expanded card carrying its exact footer note
 *   K2-b  Advanced and Failure Handling open COLLAPSED, render neither their
 *         rows nor their footer while folded, and expand on click
 *   K2-c  Search by cycles Name -> Selector -> List -> Name; the Resource and
 *         Advanced rows appear and disappear per mode, the typed Name value is
 *         retained across the cycle, and the single Output Format row reads Map
 *         in Name mode and Array in the list modes off one stored value
 *         (K8SREAD-15)
 *   K2-d  All namespaces is absent in Name mode, and ticking it in Selector
 *         mode removes Namespace
 *   K2-e  Resource Type swaps Kind between the searchable picker and a plain
 *         text row, and the stored kind survives the round trip
 *   K2-f  the open Kind picker: five tinted band headings in order, 23 kinds,
 *         alphabetical inside each band, short names inline, a kind without one
 *         rendering plain, and the check mark on the stored kind
 *   K2-g  the picker's search box filters on substring over the label or the
 *         short name, and Escape closes the picker leaving the sheet OPEN
 *   K2-h  the Kind picker stays single-select: exactly one row carries
 *         aria-checked="true" and every other row "false", the list declares
 *         no aria-multiselectable, and the arrow cursor moves without moving
 *         the stored choice
 *   K2-i  exactly session, kind and name carry the required *, every row leads
 *         with the info badge, and the enum rows take no expression
 *   K2-j  four output rows on a default sheet - result / names / count /
 *         success - with Error and Reason appearing only under Record and
 *         continue (K8SREAD-14)
 *   K2-k  Failure Handling defaults to Fail the block
 *   K2-l  the session input is a protected credential field on a secret variable
 *   K2-m  the Result Type cell follows Output Format and Search by
 *   K2-n  a Table-mode Result binds to a table variable, and a map variable is
 *         refused with the inline type-mismatch message
 *   K2-o  the Custom Kind row carries its exact info-badge wording, and the
 *         Changelog carries the Output Format entry for both mode sets
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForTooltipClosed, waitForTooltipVisible } from '../../helpers/tooltip-wait'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { chainEdges, k8sConnectNode, k8sReadNode, stackNodes } from '../../helpers/k8s-nodes'
import { configSheet, openBlockSheet } from '../../helpers/workbench'
import { expectStringParamPreview } from '../../helpers/param-config'

const GET_NODE_ID = 'k8s-get'
const SESSION_VAR = 'k8s_session'
const TABLE_VAR = 'get_result_table'
const MAP_VAR = 'get_result_map'
const SEEDED_NAME = 'payments-api'
const SEEDED_KIND = 'Deployment'

const KIND_TRIGGER = '[data-testid="enum-picker-trigger-kind"]'
const KIND_CONTENT = '[data-testid="enum-picker-content-kind"]'
const KIND_SEARCH = '[data-testid="enum-picker-search-kind"]'
const KIND_ITEM = '[data-testid^="enum-picker-item-kind-"]'

/** Exact tooltip / accessible label of the protected-credential lock. */
const SESSION_PROTECTED_LABEL = 'Value protected - references a secret variable.'

/** Exact info-badge wording of the Custom Kind row. */
const KIND_CUSTOM_INFO =
  'The kind exactly as the cluster names it. A kind this cluster does not serve fails the block.'

/** The Output Format entry the in-app Changelog carries for 1.0.0. */
const CHANGELOG_OUTPUT_FORMAT =
  'Output Format Map, Table, JSON or YAML in Name mode, and Array, Table, JSON or YAML in Selector and List mode, with Names and Count populated in every format'

const GROUP_ORDER = ['Connection', 'Resource', 'Advanced', 'Failure Handling']
const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const GROUP_FOOTERS: Record<string, string> = {
  'Connection': 'K8s Session and request timeout',
  'Resource': 'Which kind to read, how to find it, and how it comes back',
  'Advanced': 'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const KIND_BANDS = ['Workloads', 'Networking', 'Config', 'Storage', 'Cluster']
const KIND_COUNT = 23

/** Rows that must never offer the {x} expression toggle. */
const NO_EXPRESSION_ROWS = ['resource_type', 'search_by', 'output_format', 'on_error']
const REQUIRED_ROWS = ['session', 'kind', 'name']
const OUTPUT_ROWS = ['result', 'names', 'count', 'success']
const OUTPUT_ROWS_RECORD = ['result', 'names', 'count', 'success', 'error', 'reason']

/** The Search by sweep: one row per mode, listing what each group must hold. */
const SEARCH_MODES = [
  {
    id: 'K2-c/name',
    label: 'Name',
    resourceRows: ['resource_type', 'kind', 'search_by', 'name', 'output_format'],
    advancedRows: ['namespace', 'impersonate_user', 'impersonate_groups'],
  },
  {
    id: 'K2-c/selector',
    label: 'Selector',
    resourceRows: [
      'resource_type',
      'kind',
      'search_by',
      'label_selector',
      'field_selector',
      'output_format',
    ],
    advancedRows: ['all_namespaces', 'namespace', 'impersonate_user', 'impersonate_groups'],
  },
  {
    id: 'K2-c/list',
    label: 'List',
    resourceRows: ['resource_type', 'kind', 'search_by', 'output_format'],
    advancedRows: ['all_namespaces', 'namespace', 'impersonate_user', 'impersonate_groups'],
  },
]

/** The Result declared-type sweep (K8SREAD-6). */
const RESULT_TYPE_CASES = [
  { id: 'K2-m/map-name', outputFormat: 'Map', searchBy: 'Name', type: 'map' },
  { id: 'K2-m/map-selector', outputFormat: 'Array', searchBy: 'Selector', type: 'array' },
  { id: 'K2-m/map-list', outputFormat: 'Array', searchBy: 'List', type: 'array' },
  { id: 'K2-m/table-name', outputFormat: 'Table', searchBy: 'Name', type: 'table' },
  { id: 'K2-m/json-name', outputFormat: 'JSON', searchBy: 'Name', type: 'string' },
  { id: 'K2-m/yaml-name', outputFormat: 'YAML', searchBy: 'Name', type: 'string' },
]

/** The golden fixture: one Connect and one Get, every required field filled. */
function buildFixture(): Record<string, unknown> {
  return {
    name: 'V-PLUGIN-K8S-02 Get config sheet',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: stackNodes([
        k8sConnectNode({
          id: 'k8s-connect',
          values: { api_url: 'https://10.0.0.1:6443' },
          outputBindings: { session: SESSION_VAR },
        }),
        k8sReadNode({
          id: GET_NODE_ID,
          elementType: 'k8s-get',
          expressionFields: ['session'],
          values: {
            session: SESSION_VAR,
            resource_type: 'default',
            kind: SEEDED_KIND,
            search_by: 'name',
            name: SEEDED_NAME,
            output_format: 'map',
            on_error: 'fail',
          },
        }),
      ]),
      edges: chainEdges(['k8s-connect', GET_NODE_ID]),
    },
    variables: {
      [SESSION_VAR]: { value: '', type: 'string', scope: 'test', secret: true },
      [TABLE_VAR]: { value: [], type: 'table', scope: 'test' },
      [MAP_VAR]: { value: {}, type: 'map', scope: 'test' },
    },
    metadata: {},
  }
}

async function openGetSheet(page: Page): Promise<Locator> {
  await importValidateAndNavigate(page, buildFixture())
  const node = page.locator(`[data-testid="workflow-node-${GET_NODE_ID}"]`)
  await expect(node).toBeVisible({ timeout: 20_000 })
  await node.hover()
  await openBlockSheet(page, GET_NODE_ID)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

const paramRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-row-${name}"]`)

const groupHeader = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="group-header-${name}"]`)

/** The card wrapping one group header, so its rows can be read in DOM order. */
const groupCard = (modal: Locator, name: string) => groupHeader(modal, name).locator('..')

async function groupRows(modal: Locator, name: string): Promise<string[]> {
  return groupCard(modal, name)
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((rows) =>
      rows.map((row) => (row.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
}

/** Expand a collapsible group card. Idempotent. */
async function expandGroup(modal: Locator, name: string): Promise<void> {
  const header = groupHeader(modal, name)
  await header.scrollIntoViewIfNeeded()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

async function pickEnum(
  page: Page,
  modal: Locator,
  name: string,
  optionLabel: string,
): Promise<void> {
  const trigger = paramRow(modal, name).getByRole('combobox')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  await page.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(page.locator('[role="listbox"]')).toHaveCount(0)
  await expect(trigger).toContainText(optionLabel)
}

/** The Type cell: third column in both input and output mode. */
async function resultType(modal: Locator): Promise<string> {
  const raw = await modal.locator('[data-testid="output-row-result"] td:nth-child(3)').innerText()
  return raw.trim().toLowerCase()
}

/** Output row ids, in DOM order. */
async function outputIds(modal: Locator): Promise<string[]> {
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

/** Testids of the picker rows, in DOM order. */
async function kindItemIds(page: Page): Promise<string[]> {
  return page
    .locator(`${KIND_CONTENT} ${KIND_ITEM}`)
    .evaluateAll((items) =>
      items.map((item) => (item.getAttribute('data-testid') ?? '').replace('enum-picker-item-kind-', '')),
    )
}

async function openKindPicker(page: Page, modal: Locator): Promise<Locator> {
  await paramRow(modal, 'kind').scrollIntoViewIfNeeded()
  await modal.locator(KIND_TRIGGER).click()
  const content = page.locator(KIND_CONTENT).first()
  await expect(content).toBeVisible()
  return content
}

test.describe('V-PLUGIN-K8S-02: K8s Get config sheet', () => {
  test('K2-a/K2-b: four groups in order; Advanced and Failure Handling open collapsed and expand on click', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)

    const headers = modal.locator('[data-testid^="group-header-"]')
    await expect(headers).toHaveCount(4)
    const names = await headers.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('group-header-', '')),
    )
    expect(names).toEqual(GROUP_ORDER)

    // K2-b: on open, only Connection and the verb group are expanded.
    await expect(groupHeader(modal, 'Connection')).toHaveAttribute('aria-expanded', 'true')
    await expect(groupHeader(modal, 'Resource')).toHaveAttribute('aria-expanded', 'true')
    for (const name of COLLAPSED_GROUPS) {
      await expect(groupHeader(modal, name)).toHaveAttribute('aria-expanded', 'false')
      // A folded card renders neither its rows nor its footer.
      expect(await groupRows(modal, name)).toEqual([])
      await expect(modal.locator(`[data-testid="group-footer-${name}"]`)).toHaveCount(0)
    }
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(2)

    for (const name of COLLAPSED_GROUPS) {
      await expandGroup(modal, name)
    }
    expect(await groupRows(modal, 'Failure Handling')).toEqual(['on_error'])
    expect((await groupRows(modal, 'Advanced')).length).toBeGreaterThan(0)

    // K2-a: every expanded card carries its exact footer note.
    await expect(modal.locator('[data-testid^="group-footer-"]')).toHaveCount(4)
    for (const [name, footer] of Object.entries(GROUP_FOOTERS)) {
      await expect(modal.locator(`[data-testid="group-footer-${name}"]`)).toHaveText(footer)
    }

    expect(await groupRows(modal, 'Connection')).toEqual(['session', 'timeout'])
    await expect(modal.locator('[role="alert"]')).toHaveCount(0)
  })

  test('K2-c/K2-d: Search by cycles all three modes, rows follow, the Name value is retained, and All namespaces gates the Namespace row', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)
    await expandGroup(modal, 'Advanced')

    for (const mode of SEARCH_MODES) {
      await pickEnum(page, modal, 'search_by', mode.label)
      expect(await groupRows(modal, 'Resource'), mode.id).toEqual(mode.resourceRows)
      expect(await groupRows(modal, 'Advanced'), mode.id).toEqual(mode.advancedRows)
      // Output Format closes the verb group in every mode.
      expect((await groupRows(modal, 'Resource')).at(-1), mode.id).toBe('output_format')
    }

    // K2-d: All namespaces is absent in Name mode and present in the list modes.
    await pickEnum(page, modal, 'search_by', 'Name')
    await expect(paramRow(modal, 'all_namespaces')).toHaveCount(0)

    // K2-c: the seeded Name value survived Selector and List.
    await expectStringParamPreview(modal, 'name', SEEDED_NAME)

    // K8SREAD-15: two descriptors share the wire name output_format, so exactly
    // one row renders and the first option is named after the type the mode
    // returns while the stored value stays put.
    await expect(paramRow(modal, 'output_format')).toHaveCount(1)
    await expect(paramRow(modal, 'output_format').getByRole('combobox')).toHaveText('Map')
    await pickEnum(page, modal, 'search_by', 'List')
    await expect(paramRow(modal, 'output_format')).toHaveCount(1)
    await expect(paramRow(modal, 'output_format').getByRole('combobox')).toHaveText('Array')
    await pickEnum(page, modal, 'search_by', 'Name')
    await expect(paramRow(modal, 'output_format').getByRole('combobox')).toHaveText('Map')

    // K2-d: ticking All namespaces drops the Namespace row.
    await pickEnum(page, modal, 'search_by', 'Selector')
    const allNamespaces = paramRow(modal, 'all_namespaces').locator('[role="checkbox"]')
    await allNamespaces.click()
    await expect(allNamespaces).toHaveAttribute('data-state', 'checked')
    expect(await groupRows(modal, 'Advanced')).toEqual([
      'all_namespaces',
      'impersonate_user',
      'impersonate_groups',
    ])
  })

  test('K2-e: Resource Type swaps Kind between the picker and a plain text row, and the stored kind survives', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)

    await expect(modal.locator(KIND_TRIGGER)).toHaveCount(1)
    await expect(modal.locator(KIND_TRIGGER)).toHaveText(SEEDED_KIND)
    await expect(paramRow(modal, 'kind_custom')).toHaveCount(0)

    await pickEnum(page, modal, 'resource_type', 'Custom')
    await expect(modal.locator(KIND_TRIGGER)).toHaveCount(0)
    const custom = paramRow(modal, 'kind_custom')
    await expect(custom).toBeVisible()
    await expect(custom.locator('td').nth(1)).toContainText('Kind')
    await expect(custom.locator('td:nth-child(2) span.text-destructive')).toHaveCount(1)
    // A plain string row: no select trigger, no chevron, and it takes an expression.
    await expect(custom.getByRole('combobox')).toHaveCount(0)
    await expect(custom.locator('svg.lucide-chevron-down')).toHaveCount(0)
    await expect(custom.locator('[data-testid="expression-toggle"]')).toHaveCount(1)

    await pickEnum(page, modal, 'resource_type', 'Default')
    await expect(paramRow(modal, 'kind_custom')).toHaveCount(0)
    await expect(modal.locator(KIND_TRIGGER)).toHaveText(SEEDED_KIND)
  })

  test('K2-f/K2-g: the Kind picker bands, ordering and short names; the search box filters on substring and Escape leaves the sheet open', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)
    const content = await openKindPicker(page, modal)

    const bands = await content
      .locator('[data-testid^="enum-picker-group-kind-"]')
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute('data-testid') ?? '').replace('enum-picker-group-kind-', '')),
      )
    expect(bands).toEqual(KIND_BANDS)
    await expect(content.locator(KIND_ITEM)).toHaveCount(KIND_COUNT)

    // K8SREAD-5: the heading is a tinted band spanning the list width.
    const band = await content
      .locator('[data-testid="enum-picker-group-kind-Workloads"] [cmdk-group-heading]')
      .evaluate((el) => {
        const own = getComputedStyle(el)
        const list = getComputedStyle(el.closest('[cmdk-list]') ?? el.parentElement!)
        return {
          bg: own.backgroundColor,
          listBg: list.backgroundColor,
          width: el.getBoundingClientRect().width,
          groupWidth: el.closest('[cmdk-group]')!.getBoundingClientRect().width,
        }
      })
    expect(band.bg, JSON.stringify(band)).not.toMatch(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)|transparent/)
    expect(band.bg, JSON.stringify(band)).not.toBe(band.listBg)
    expect(band.width, JSON.stringify(band)).toBeGreaterThanOrEqual(band.groupWidth - 2)

    for (const heading of bands) {
      const kinds = await content
        .locator(`[data-testid="enum-picker-group-kind-${heading}"] ${KIND_ITEM}`)
        .evaluateAll((els) =>
          els.map((el) => (el.getAttribute('data-testid') ?? '').replace('enum-picker-item-kind-', '')),
        )
      expect(kinds, heading).toEqual([...kinds].sort((a, b) => a.localeCompare(b)))
    }

    // Short name inline, to the right of the label; a kind without one renders plain.
    const deployment = content.locator('[data-testid="enum-picker-item-kind-Deployment"]')
    const deploymentSpans = deployment.locator('span.items-baseline > span')
    await expect(deploymentSpans).toHaveCount(2)
    await expect(deploymentSpans.nth(0)).toHaveText('Deployment')
    await expect(deploymentSpans.nth(1)).toHaveText('deploy')
    const labelBox = await deploymentSpans.nth(0).boundingBox()
    const shortBox = await deploymentSpans.nth(1).boundingBox()
    expect(shortBox!.x).toBeGreaterThan(labelBox!.x + labelBox!.width - 1)
    expect(Math.abs(shortBox!.y + shortBox!.height - (labelBox!.y + labelBox!.height))).toBeLessThan(6)

    const job = content.locator('[data-testid="enum-picker-item-kind-Job"]')
    await expect(job.locator('span.items-baseline')).toHaveCount(0)
    await expect(job).toHaveText('Job')

    await expect(content.locator('[data-testid="enum-picker-check-kind"]')).toHaveCount(1)
    await expect(
      content.locator(`[data-testid="enum-picker-item-kind-${SEEDED_KIND}"] [data-testid="enum-picker-check-kind"]`),
    ).toHaveCount(1)

    // K2-g: "po" matches the label Pod and the short names ep and netpol only.
    await page.locator(KIND_SEARCH).fill('po')
    await expect(content.locator(KIND_ITEM)).toHaveCount(3)
    expect((await kindItemIds(page)).sort()).toEqual(['Endpoints', 'NetworkPolicy', 'Pod'])
    await expect(content.locator('[data-testid^="enum-picker-group-kind-"]')).toHaveCount(2)

    // Nothing matches: the empty state, no rows.
    await page.locator(KIND_SEARCH).fill('zzzz')
    await expect(content.locator(KIND_ITEM)).toHaveCount(0)
    await expect(content.locator('[data-testid="enum-picker-empty-kind"]')).toHaveText(
      'No matching options',
    )

    // K2-g: Escape closes the picker only - the config sheet stays open.
    await page.keyboard.press('Escape')
    await expect(page.locator(KIND_CONTENT)).toHaveCount(0)
    await expect(modal).toBeVisible()
    await expect(modal.locator(KIND_TRIGGER)).toHaveText(SEEDED_KIND)
  })

  test('K2-h: the Kind picker stays single-select - exactly one aria-checked row, no aria-multiselectable, and the arrow cursor never moves the stored choice', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)
    const content = await openKindPicker(page, modal)

    const stored = content.locator(`[data-testid="enum-picker-item-kind-${SEEDED_KIND}"]`)
    await expect(stored).toHaveAttribute('data-state', 'checked')
    await expect(stored).toHaveAttribute('aria-checked', 'true')
    await expect(stored.locator('[data-testid="enum-picker-check-kind"]')).toHaveCount(1)

    // Single-select: the stored choice is the only checked row, and the list
    // makes no multi-select declaration.
    await expect(content.locator(`${KIND_ITEM}[aria-checked="true"]`)).toHaveCount(1)
    await expect(content.locator(`${KIND_ITEM}:not([aria-checked])`)).toHaveCount(0)
    await expect(page.locator('[data-testid="enum-picker-list-kind"]')).not.toHaveAttribute(
      'aria-multiselectable',
    )

    const ids = await kindItemIds(page)
    const expectedCursor = ids[ids.indexOf(SEEDED_KIND) + 2]
    await page.locator(KIND_SEARCH).press('ArrowDown')
    await page.locator(KIND_SEARCH).press('ArrowDown')

    const cursor = content.locator(`${KIND_ITEM}[aria-selected="true"]`)
    await expect(cursor).toHaveCount(1)
    await expect(cursor).toHaveAttribute('data-testid', `enum-picker-item-kind-${expectedCursor}`)
    expect(expectedCursor).not.toBe(SEEDED_KIND)

    // The stored choice did not move with the cursor.
    await expect(cursor).toHaveAttribute('aria-checked', 'false')
    await expect(stored).toHaveAttribute('data-state', 'checked')
    await expect(stored).toHaveAttribute('aria-checked', 'true')
    await expect(content.locator(`${KIND_ITEM}[aria-checked="true"]`)).toHaveCount(1)
    await expect(stored.locator('[data-testid="enum-picker-check-kind"]')).toHaveCount(1)
    await expect(content.locator('[data-testid="enum-picker-check-kind"]')).toHaveCount(1)

    // The picker library leaves this null until the first cursor move, so it is
    // only readable after the arrow keys above.
    const activeDescendant = await page.locator(KIND_SEARCH).getAttribute('aria-activedescendant')
    expect(activeDescendant).toBeTruthy()
    await expect(cursor).toHaveAttribute('id', activeDescendant!)
  })

  test('K2-i/K2-k/K2-l: required markers, info badges, the expression policy, the Failure Handling default and the protected session field', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)
    for (const name of COLLAPSED_GROUPS) {
      await expandGroup(modal, name)
    }

    const rows = modal.locator('[data-testid^="param-row-"]')
    const visible = await rows.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )

    // K2-i: exactly session, kind and name carry the required marker.
    for (const name of visible) {
      await expect(
        paramRow(modal, name).locator('td:nth-child(2) span.text-destructive'),
        name,
      ).toHaveCount(REQUIRED_ROWS.includes(name) ? 1 : 0)
    }
    for (const name of REQUIRED_ROWS) {
      expect(visible, `${name} must be on the sheet`).toContain(name)
    }

    // K2-i: every row leads with the (i) info badge.
    for (const name of visible) {
      await expect(paramRow(modal, name).locator('td').first().locator('svg'), name).toBeVisible()
    }

    // K2-i: the enum and gate rows take no expression.
    for (const name of NO_EXPRESSION_ROWS) {
      await expect(paramRow(modal, name), name).toHaveCount(1)
      await expect(
        paramRow(modal, name).locator('[data-testid="expression-toggle"]'),
        name,
      ).toHaveCount(0)
    }

    // K2-k: Failure Handling holds On error alone, defaulting to Fail the block.
    expect(await groupRows(modal, 'Failure Handling')).toEqual(['on_error'])
    await expect(paramRow(modal, 'on_error').getByRole('combobox')).toHaveText('Fail the block')

    // K2-l: the session field is a credential slot pointing at a secret variable.
    const session = paramRow(modal, 'session')
    await expect(session.locator('[data-testid="expression-toggle"]')).toHaveAttribute(
      'data-state',
      'on',
    )
    await expect(session.getByLabel(SESSION_PROTECTED_LABEL, { exact: true })).toBeVisible()
  })

  test('K2-j/K2-m: four outputs on a default sheet, Error and Reason only under Record and continue, and the Result Type cell follows Output Format and Search by', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)

    const outputs = modal.locator('[data-testid^="output-row-"]')
    await expect(outputs).toHaveCount(OUTPUT_ROWS.length)
    expect(await outputIds(modal)).toEqual(OUTPUT_ROWS)
    await expect(modal.locator('[data-testid="output-row-result"]')).toContainText('Result')

    for (const testCase of RESULT_TYPE_CASES) {
      await pickEnum(page, modal, 'search_by', testCase.searchBy)
      await pickEnum(page, modal, 'output_format', testCase.outputFormat)
      await expect.poll(() => resultType(modal), { message: testCase.id }).toBe(testCase.type)
      // K2-j: the read mode never changes the census; only On error does.
      await expect(outputs, testCase.id).toHaveCount(OUTPUT_ROWS.length)
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

  test('K2-n: a Table-mode Result binds to a table variable and refuses a map variable with the inline type-mismatch message', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)
    await pickEnum(page, modal, 'output_format', 'Table')
    await expect.poll(() => resultType(modal)).toBe('table')

    const binding = modal.locator('[data-testid="output-row-result"] [role="combobox"]')
    const bindingError = modal.locator('[data-testid="field-error-result"]')
    const save = modal.getByRole('button', { name: 'Save' })

    await binding.fill(MAP_VAR)
    await expect(bindingError).toHaveText(
      `Type mismatch: "${MAP_VAR}" is map, expected table`,
    )
    await expect(save).toBeDisabled()

    await binding.fill(TABLE_VAR)
    await expect(bindingError).toHaveCount(0)
    await expect(save).toBeEnabled()

    // Escape closes the suggestion list only, so it cannot cover the Save button.
    await binding.press('Escape')
    await expect(modal).toBeVisible()
    await save.click()
    await expect(modal).not.toBeVisible()

    // Reopen the same Block: the accepted binding survived the round trip.
    const node = page.locator(`[data-testid="workflow-node-${GET_NODE_ID}"]`)
    await node.hover()
    await openBlockSheet(page, GET_NODE_ID)
    await expect(modal).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-result"] [role="combobox"]')).toHaveValue(
      TABLE_VAR,
    )
    await expect.poll(() => resultType(modal)).toBe('table')
  })

  test('K2-o: the Custom Kind row carries its exact info-badge wording and the Changelog carries the Output Format entry', async ({
    page,
  }) => {
    const modal = await openGetSheet(page)

    await pickEnum(page, modal, 'resource_type', 'Custom')
    await expect(paramRow(modal, 'kind_custom')).toBeVisible()
    await expectInfoBadge(page, paramRow(modal, 'kind_custom'), KIND_CUSTOM_INFO)

    // K8SREAD-15: the in-app help names both option sets, so the sheet and the
    // help cannot disagree about which word the first option carries.
    await modal.getByRole('button', { name: 'Changelog' }).click()
    const changelog = page.locator('[data-testid="changelog-scroll"]')
    await expect(changelog).toBeVisible()
    await expect(changelog).toContainText(CHANGELOG_OUTPUT_FORMAT)

    await page.keyboard.press('Escape')
    await expect(changelog).toHaveCount(0)
    await expect(modal).toBeVisible()
  })
})
