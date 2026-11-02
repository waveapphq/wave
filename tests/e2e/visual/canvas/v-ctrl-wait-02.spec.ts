/**
 * V-CTRL-WAIT-02: Wait Until configuration sheet
 *
 * Design Decisions: WAIT-1, WAIT-2, WAIT-3, WAIT-4, WAIT-6
 * REQ: REQ-3.5.4.3 (wait until condition with timeout), REQ-3.5.4.4 (poll-based checking)
 *
 * Pass Criteria:
 * 1. Input Parameters are exactly Timeout (required), Check Interval and Timeout
 *    Message, in that order; Wait Mode and Fail Current Scope are NOT table rows
 * 2. The assertion builder sits directly under the table with "+ Add Assertion"
 *    and "+ Add Group" beneath it
 * 3. Output Variables are exactly Passed (Boolean) and Elapsed (Integer), each
 *    with an Assign to field
 * 4. WAIT MODE is an uppercase muted heading; Retry is first and selected, Watch
 *    is second, and each option carries its own description
 * 5. Fail Current Scope sits below a top border rule, off by default, with its
 *    description
 * 6. Picking Watch and saving persists mode "watch" AND the node drops to the
 *    single default egress - the mode is a real change, not a label
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'

const BASE = `http://localhost:${BACKEND_PORT}`

const WAIT_ID = 'wait-cfg'

const RETRY_DESCRIPTION =
  'Two outputs - a retry branch that runs on every round to try to make the condition true, and the exit the flow continues down.'
const WATCH_DESCRIPTION =
  'One output. The wait just re-checks the condition each round and continues when it comes true.'
const FAIL_SCOPE_DESCRIPTION =
  'When enabled, running out of time fails the block (shown red) and stops the flow. When disabled, it is informational only (shown amber).'

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-CTRL-WAIT-02 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'One Retry-mode Wait Until with a complete condition.',
    workflow: {
      nodes: [
        {
          id: WAIT_ID,
          type: 'workflowNode',
          position: { x: 320, y: 200 },
          data: {
            label: 'Wait Until',
            elementType: 'wait-until',
            nodeType: 'control',
            category: 'timing',
            version: '1.0.0',
            description: 'Wait under test',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                conditions: [
                  {
                    type: 'literal',
                    variable: 'phase',
                    value_type: 'string',
                    operator: 'equals',
                    reference_value: 'Running',
                    reference_is_expression: false,
                    id: 'cond-0',
                  },
                ],
                timeout: 30000,
                check_interval: 1000,
                mode: 'retry',
                fail_current_scope: false,
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 160, height: 62 },
        },
      ],
      edges: [{ id: 'e-start', source: 'start-node', target: WAIT_ID, type: 'default' }],
    },
    variables: { phase: { value: 'Pending', type: 'string', scope: 'test' } },
    metadata: {},
  }
}

async function seedAndOpen(page: Page): Promise<string> {
  await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  const resp = await page.request.post(`${BASE}/tests`, { data: buildFixture() })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = body.data?.id ?? body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

async function openConfig(page: Page): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${WAIT_ID}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openSelectedBlockSheet(page)
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  await expect(sheet.locator('[data-testid="assertion-builder"]')).toBeVisible()
  return sheet
}

async function persistedValues(page: Page, testId: string): Promise<Record<string, unknown>> {
  const resp = await page.request.get(`${BASE}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as { nodes?: Array<Record<string, unknown>> }
  const node = (data.nodes ?? []).find((n) => n.id === WAIT_ID)
  const nodeData = (node?.data ?? {}) as Record<string, unknown>
  const config = (nodeData.config ?? {}) as Record<string, unknown>
  return (config.values as Record<string, unknown>) ?? {}
}

test.describe('V-CTRL-WAIT-02: Wait Until configuration sheet', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  })

  test('S1: input parameters, assertion builder, and output rows', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    await test.step('Three timing rows in wireframe order, Timeout required', async () => {
      const rows = await sheet
        .locator('[data-testid^="param-row-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
      expect(rows, `input rows: ${JSON.stringify(rows)}`).toEqual([
        'param-row-timeout',
        'param-row-check_interval',
        'param-row-message',
      ])
      await expect(
        sheet.locator('[data-testid="param-row-timeout"] .text-destructive'),
      ).toHaveCount(1)
      await expect(
        sheet.locator('[data-testid="param-row-check_interval"] .text-destructive'),
      ).toHaveCount(0)
      await expect(
        sheet.locator('[data-testid="param-row-message"] .text-destructive'),
      ).toHaveCount(0)
    })

    await test.step('Mode and Fail Current Scope are not table rows', async () => {
      await expect(sheet.locator('[data-testid="param-row-mode"]')).toHaveCount(0)
      await expect(sheet.locator('[data-testid="param-row-fail_current_scope"]')).toHaveCount(0)
    })

    await test.step('The assertion builder carries the two add buttons', async () => {
      const builder = sheet.locator('[data-testid="assertion-builder"]')
      await expect(builder.locator('[data-testid="assert-add-assertion"]')).toBeVisible()
      await expect(builder.locator('[data-testid="assert-add-group"]')).toBeVisible()
      await expect(builder.locator('[data-testid="assert-row-0"]')).toBeVisible()

      // Wireframe order: parameter table, then the builder, then the outputs.
      const lastParam = await sheet.locator('[data-testid="param-row-message"]').boundingBox()
      const builderBox = await builder.boundingBox()
      const firstOutput = await sheet.locator('[data-testid="output-row-passed"]').boundingBox()
      expect(builderBox!.y, 'the builder sits under the parameter table').toBeGreaterThan(
        lastParam!.y,
      )
      expect(firstOutput!.y, 'the outputs sit under the builder').toBeGreaterThan(builderBox!.y)
    })

    await test.step('Exactly two outputs: Passed (Boolean) and Elapsed (Integer)', async () => {
      const outputs = await sheet
        .locator('[data-testid^="output-row-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
      expect(outputs, `output rows: ${JSON.stringify(outputs)}`).toEqual([
        'output-row-passed',
        'output-row-elapsed',
      ])
      // The type cell is CSS-capitalized, so match the word, not its casing.
      await expect(sheet.locator('[data-testid="output-row-passed"]')).toContainText(/boolean/i)
      await expect(sheet.locator('[data-testid="output-row-elapsed"]')).toContainText(/integer/i)
      for (const row of ['output-row-passed', 'output-row-elapsed']) {
        await expect(
          sheet.locator(`[data-testid="${row}"] [role="combobox"][placeholder="variable_name"]`),
        ).toHaveCount(1)
      }
    })
  })

  test('S2: the WAIT MODE section and its Fail Current Scope checkbox', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    await test.step('Uppercase muted heading, same treatment as the other sections', async () => {
      // Case-insensitive: the heading is uppercased in CSS, which Chromium
      // folds into the accessible name.
      const heading = sheet.getByRole('heading', { name: /wait mode/i })
      await expect(heading).toBeVisible()
      await expect(heading).toHaveClass(/uppercase/)
      await expect(heading).toHaveClass(/text-muted-foreground/)
    })

    await test.step('Retry first and selected, Watch second, each described', async () => {
      const retry = sheet.locator('#wait-mode-retry')
      const watch = sheet.locator('#wait-mode-watch')
      await expect(retry).toHaveAttribute('data-state', 'checked')
      await expect(watch).toHaveAttribute('data-state', 'unchecked')

      const retryBox = await retry.boundingBox()
      const watchBox = await watch.boundingBox()
      expect(retryBox!.y, 'Retry must sit above Watch').toBeLessThan(watchBox!.y)

      await expect(sheet.locator('label[for="wait-mode-retry"]')).toHaveText('Retry')
      await expect(sheet.locator('label[for="wait-mode-watch"]')).toHaveText('Watch')
      await expect(sheet).toContainText(RETRY_DESCRIPTION)
      await expect(sheet).toContainText(WATCH_DESCRIPTION)
    })

    await test.step('Fail Current Scope: off, below a rule, with its description', async () => {
      const checkbox = sheet.locator('#wait-fail-current-scope')
      await expect(checkbox).toHaveAttribute('data-state', 'unchecked')
      await expect(sheet.locator('label[for="wait-fail-current-scope"]')).toHaveText(
        'Fail Current Scope',
      )
      await expect(sheet).toContainText(FAIL_SCOPE_DESCRIPTION)
      const borderTop = await checkbox.evaluate(
        (el) => getComputedStyle(el.parentElement as HTMLElement).borderTopWidth,
      )
      expect(borderTop, 'the checkbox sits under a top border rule').not.toBe('0px')
    })
  })

  test('S3: picking Watch persists the mode and drops the node to one egress', async ({ page }) => {
    const testId = await seedAndOpen(page)
    const sheet = await openConfig(page)

    const node = page.locator(`[data-testid="workflow-node-${WAIT_ID}"]`)
    await expect(node.locator('[data-testid="handle-output-retry"]')).toBeVisible()

    await sheet.locator('label[for="wait-mode-watch"]').click()
    await expect(sheet.locator('#wait-mode-watch')).toHaveAttribute('data-state', 'checked')

    await sheet.getByRole('button', { name: /^Save$/ }).click()
    await expect(sheet).toBeHidden({ timeout: 10_000 })

    await test.step('The canvas node loses its lanes for the single default egress', async () => {
      await expect(node.locator('[data-testid="handle-output"]')).toBeVisible()
      await expect(node.locator('[data-testid="handle-output-retry"]')).toHaveCount(0)
      await expect(node.locator('[data-testid="handle-output-then"]')).toHaveCount(0)
    })

    await test.step('The saved test carries mode "watch"', async () => {
      const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
      await expect(toolbarSave).toBeEnabled({ timeout: 10_000 })
      await toolbarSave.click()
      await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })

      const values = await persistedValues(page, testId)
      expect(values.mode, `persisted values: ${JSON.stringify(values)}`).toBe('watch')
      expect(values.timeout, `persisted values: ${JSON.stringify(values)}`).toBe(30000)
    })
  })
})
