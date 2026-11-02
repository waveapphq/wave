/**
 * V-VARPICK-SURFACES-FUNCTIONAL: one variable picker, every condition surface.
 *
 * The shared combobox replaces a hand-rolled selector everywhere a
 * condition names a variable. This proves the same behavior on all four
 * surfaces - Switch cases, If/Else branches, Assert and While - rather than on
 * whichever one happened to be tested: a long name stays readable with its type
 * visible and its full text reachable, the list narrows as you type, the typed
 * text is a filter (never a name), and no character counter appears.
 *
 * The table Transform editors take the same root-filtered variable list, so
 * their expression autocomplete is checked for the same rule.
 *
 * REQ: REQ-3.5.1.20 (shared variable picker, VARPICK-1, VARPICK-2)
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet, openBlockSheet } from '../../helpers/workbench'

const UNIQUE = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** 60 chars - long enough to overflow the condition row, short enough to be a
 *  legal variable name. */
const LONG_NAME = 'threshold_for_the_downstream_service_response_time_in_millis'
const OTHER_NAME = 'mode'

const SWITCH_ID = 'vp-sw'
const IFELSE_ID = 'vp-ie'
const ASSERT_ID = 'vp-as'
const WHILE_ID = 'vp-wh'
const CSV_ID = 'vp-csv'

function condition(id: string, variable: string) {
  return {
    type: 'literal',
    variable,
    value_type: 'string',
    operator: 'equals',
    reference_value: 'go',
    reference_is_expression: false,
    id,
  }
}

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-VARPICK surfaces ${UNIQUE}`,
    version: '1.0.0',
    description: 'One condition surface per control, all sharing the variable picker.',
    workflow: {
      nodes: [
        {
          id: SWITCH_ID,
          type: 'workflowNode',
          position: { x: 320, y: 120 },
          data: {
            label: 'Switch',
            elementType: 'switch-case',
            nodeType: 'control',
            category: 'conditional',
            version: '1.0.0',
            description: 'Switch surface',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                branches: [
                  {
                    id: 'branch_0',
                    type: 'case',
                    label: 'first',
                    break: true,
                    conditions: [condition('vp-sw-cond', OTHER_NAME)],
                  },
                ],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: IFELSE_ID,
          type: 'workflowNode',
          position: { x: 320, y: 280 },
          data: {
            label: 'If/Else',
            elementType: 'if-else',
            nodeType: 'control',
            category: 'conditional',
            version: '1.0.0',
            description: 'If/Else surface',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                branches: [
                  {
                    id: 'branch_0',
                    type: 'if',
                    label: 'first',
                    conditions: [condition('vp-ie-cond', OTHER_NAME)],
                  },
                  { id: 'branch_1', type: 'else', label: '' },
                ],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: ASSERT_ID,
          type: 'workflowNode',
          position: { x: 320, y: 440 },
          data: {
            label: 'Assert',
            elementType: 'assert',
            nodeType: 'control',
            category: 'flow',
            version: '1.0.0',
            description: 'Assert surface',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { mode: 'single', assertions: [condition('vp-as-cond', OTHER_NAME)] },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: WHILE_ID,
          type: 'workflowNode',
          position: { x: 320, y: 600 },
          data: {
            label: 'While Loop',
            elementType: 'while',
            nodeType: 'control',
            category: 'loop',
            version: '1.0.0',
            description: 'While surface',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                mode: 'while-do',
                max_iterations: 1,
                conditions: [condition('vp-wh-cond', OTHER_NAME)],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: CSV_ID,
          type: 'workflowNode',
          position: { x: 320, y: 760 },
          data: {
            label: 'CSV Parser',
            elementType: 'csv-parser',
            nodeType: 'plugin',
            category: 'data',
            version: '1.0.0',
            description: 'Table transform surface',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                operation: 'parse',
                csv_content: 'a,b\n1,2',
                delimiter: ',',
                has_header: true,
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: SWITCH_ID, type: 'default' },
        { id: 'e-sw-then', source: SWITCH_ID, sourceHandle: 'then', target: IFELSE_ID, type: 'default' },
        { id: 'e-ie-if', source: IFELSE_ID, sourceHandle: 'branch_0', target: ASSERT_ID, type: 'default' },
        { id: 'e-as-pass', source: ASSERT_ID, target: WHILE_ID, type: 'default' },
        { id: 'e-wh-then', source: WHILE_ID, sourceHandle: 'then', target: CSV_ID, type: 'default' },
      ],
    },
    variables: {
      [OTHER_NAME]: { value: 'go', type: 'string', scope: 'test' },
      [LONG_NAME]: { value: 250, type: 'integer', scope: 'test' },
    },
    metadata: {},
  }
}

interface Surface {
  name: string
  nodeId: string
  /** Selector, relative to the config sheet, of that surface's picker anchor. */
  anchor: string
}

const SURFACES: Surface[] = [
  {
    name: 'Switch case',
    nodeId: SWITCH_ID,
    anchor: '[data-testid="case-body-branch_0"] [data-testid="assert-variable-0"]',
  },
  {
    name: 'If/Else branch',
    nodeId: IFELSE_ID,
    anchor: '[data-testid="branch-body-branch_0"] [data-testid="assert-variable-0"]',
  },
  { name: 'Assert', nodeId: ASSERT_ID, anchor: '[data-testid="assert-variable-0"]' },
  { name: 'While', nodeId: WHILE_ID, anchor: '[data-testid="assert-variable-0"]' },
]

async function seed(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: buildFixture() })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `Create test failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return (body.data?.id ?? body.id) as string
}

async function openWorkbench(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openConfig(page: Page, nodeId: string): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.scrollIntoViewIfNeeded()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openBlockSheet(page, nodeId)
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  return sheet
}

test.describe('V-VARPICK-SURFACES: the same picker on every condition surface', () => {
  let testId: string

  test.beforeAll(async ({ request }) => {
    testId = await seed(request)
  })

  test.afterAll(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  })

  for (const surface of SURFACES) {
    test(`${surface.name}: long names stay readable and the list narrows on typing`, async ({
      page,
    }) => {
      await openWorkbench(page, testId)
      const sheet = await openConfig(page, surface.nodeId)

      const anchor = sheet.locator(surface.anchor)
      await expect(anchor).toBeVisible()
      await anchor.click()

      const options = page.getByRole('option')
      await expect(options.first()).toBeVisible({ timeout: 5_000 })

      await test.step('The long name truncates but stays fully reachable', async () => {
        const longOption = options.filter({ hasText: LONG_NAME }).first()
        const nameSpan = longOption.locator('span.font-mono').first()
        await expect(nameSpan).toHaveClass(/truncate/)
        await expect(nameSpan).toHaveClass(/min-w-0/)
        await expect(nameSpan).toHaveClass(/flex-1/)
        // SHELL-7a: the browser's own popup is gone; the shared tooltip carries
        // the full name (hover-proved in the tooltip-convergence spec).
        await expect(nameSpan).not.toHaveAttribute('title', /.*/)

        // Truncated on screen: the text overflows the box it is painted in.
        const overflows = await nameSpan.evaluate(
          (el) => el.scrollWidth > el.clientWidth + 1,
        )
        expect(overflows, 'a 60-character name must not render at full width').toBeTruthy()

        // The row itself does not push the popover into a horizontal scroll.
        const popoverOverflow = await longOption.evaluate((el) => {
          const list = el.closest('[cmdk-list]') ?? el.parentElement
          return list ? list.scrollWidth - list.clientWidth : 0
        })
        expect(popoverOverflow, 'the option list must not scroll horizontally').toBeLessThanOrEqual(1)
      })

      await test.step('The type stays visible next to the name', async () => {
        const longOption = options.filter({ hasText: LONG_NAME }).first()
        await expect(longOption).toContainText('integer')
      })

      await test.step('Typing filters the list without becoming the value', async () => {
        const before = await options.count()
        expect(before, 'both variables are offered before filtering').toBeGreaterThan(1)

        await anchor.fill('threshold')
        await expect(options).toHaveCount(1, { timeout: 5_000 })
        await expect(options.first()).toContainText(LONG_NAME)

        // Existing-only: the filter text is not a name, so no counter appears.
        await expect(sheet.locator('[data-testid="assert-variable-0-counter"]')).toHaveCount(0)

        await page.keyboard.press('Escape')
        await expect(anchor, 'the bound value survives a discarded filter').toHaveValue(OTHER_NAME)
      })
    })
  }

  test('table Filters and Sorts resolve names against the same variable list', async ({ page }) => {
    await openWorkbench(page, testId)
    const sheet = await openConfig(page, CSV_ID)

    await test.step('A filter predicate completes the test variable by name', async () => {
      await sheet.locator('[data-testid="csv-filters-section-trigger"]').click()
      await sheet.locator('[data-testid="filter-add-block"]').click()
      const block = sheet.locator('[data-testid^="filter-block-"]').first()
      await block.locator('[data-testid^="filter-add-expression-"]').click()

      const editor = block.locator('.cm-content').first()
      await expect(editor).toBeVisible()
      await editor.click()
      await page.keyboard.press('Control+a')
      await page.keyboard.type('thresh', { delay: 40 })

      const autocomplete = page.locator('.cm-tooltip-autocomplete')
      await expect(autocomplete).toBeVisible({ timeout: 5_000 })
      const labels = (
        await autocomplete.locator('.cm-completionLabel').allTextContents()
      ).map((l) => l.trim())
      expect(
        labels,
        `the Transform editor sees the same variables as the pickers: ${JSON.stringify(labels)}`,
      ).toContain(LONG_NAME)
    })

    await test.step('A sort key names a column and keeps its own mode', async () => {
      await leaveExpressionEditor(sheet)
      await sheet.locator('[data-testid="csv-sorts-section-trigger"]').click()
      await sheet.locator('[data-testid="sort-add-button"]').click()
      const sortRow = sheet.locator('[data-testid^="sort-row-"]').first()
      const value = sortRow.locator('[data-testid="column-ref-value"]')
      await value.fill('b')
      await expect(value).toHaveValue('b')
      await expect(sheet.locator('[data-testid="csv-sorts-section-count"]')).toHaveText('1 keys')
    })
  })
})
