/**
 * V-CTRL-SWITCH-02: Switch/Case configuration sheet
 *
 * Design Decisions: SWITCH-2, SWITCH-3, SWITCH-4, SWITCH-8, SWITCH-9, SWITCH-10
 * REQ: REQ-3.5.1.20 (Switch/Case multi-branch decisions)
 *
 * Pass Criteria:
 * 1. Case cards carry chevron, CASE badge, name field, Break switch, reorder
 *    pair and trash - in that order - with trash disabled on the only case
 * 2. "+ Case" and "+ Default" add their branch; "+ Default" grays out once a
 *    default exists; the DEFAULT card sits last with no Break and no reorder
 * 3. The DEFAULT body states what it actually does: it also runs when a case
 *    above falls through (SWITCH-4)
 * 4. A collapsed case still shows its Break switch and grows no annotation line
 * 5. A blocked Save says why, collapsed or not
 * 6. Half-built conditions must not save: an unpicked variable and an
 *    empty expression both outline red and refuse Save; completing them unlocks
 *    Save and the completed condition is what reaches storage
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { addExpressionRow, addLiteralRow, pickConditionVariable } from '../../helpers/condition-builder'

const BASE = `http://localhost:${BACKEND_PORT}`

const SWITCH_ID = 'sw-cfg'
const DEFAULT_CAPTION = 'Runs when no case matched, or when a case above falls through'

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-CTRL-SWITCH-02 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'One Switch with a single complete case.',
    workflow: {
      nodes: [
        {
          id: SWITCH_ID,
          type: 'workflowNode',
          position: { x: 320, y: 200 },
          data: {
            label: 'Switch',
            elementType: 'switch-case',
            nodeType: 'control',
            category: 'conditional',
            version: '1.0.0',
            description: 'Switch under test',
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
                    conditions: [
                      {
                        type: 'literal',
                        variable: 'mode',
                        value_type: 'string',
                        operator: 'equals',
                        reference_value: 'go',
                        reference_is_expression: false,
                        id: 'cond-0',
                      },
                    ],
                  },
                ],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [{ id: 'e-start', source: 'start-node', target: SWITCH_ID, type: 'default' }],
    },
    variables: { mode: { value: 'go', type: 'string', scope: 'test' } },
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
  const node = page.locator(`[data-testid="workflow-node-${SWITCH_ID}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openSelectedBlockSheet(page)
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  await expect(sheet.locator('[data-testid="case-branch-editor"]')).toBeVisible()
  return sheet
}

function saveButton(sheet: Locator): Locator {
  return sheet.getByRole('button', { name: /^Save$/ })
}

async function persistedBranches(
  page: Page,
  testId: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await page.request.get(`${BASE}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as { nodes?: Array<Record<string, unknown>> }
  const node = (data.nodes ?? []).find((n) => n.id === SWITCH_ID)
  const nodeData = (node?.data ?? {}) as Record<string, unknown>
  const config = (nodeData.config ?? {}) as Record<string, unknown>
  const values = (config.values ?? {}) as Record<string, unknown>
  return (values.branches as Array<Record<string, unknown>>) ?? []
}

test.describe('V-CTRL-SWITCH-02: Switch/Case configuration sheet', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  })

  test('S1: case card anatomy and add-button states', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    await test.step('One CASE card, trash disabled because it is the only case', async () => {
      await expect(sheet.locator('[data-testid^="case-card-"]')).toHaveCount(1)
      await expect(sheet.locator('[data-testid="case-badge-branch_0"]')).toHaveText('CASE')
      await expect(sheet.locator('[data-testid="case-delete-branch_0"]')).toBeDisabled()
      await expect(sheet.locator('[data-testid="case-delete-branch_0"]')).toHaveClass(
        /cursor-not-allowed/,
      )
    })

    await test.step('Header order: chevron, badge, name, Break, up, down, trash', async () => {
      const header = sheet.locator('[data-testid="case-header-branch_0"]')
      const order = await header.evaluate((el) =>
        Array.from(el.querySelectorAll('[data-testid]'))
          .map((n) => n.getAttribute('data-testid'))
          .filter((id): id is string => !!id),
      )
      expect(order, `header children: ${JSON.stringify(order)}`).toEqual([
        'case-toggle-branch_0',
        'case-badge-branch_0',
        'case-label-branch_0',
        'case-break-branch_0',
        'case-move-up-branch_0',
        'case-move-down-branch_0',
        'case-delete-branch_0',
      ])
    })

    await test.step('Break defaults on, and reorder is pinned at the single-case ends', async () => {
      await expect(sheet.locator('[data-testid="case-break-branch_0"]')).toHaveAttribute(
        'data-state',
        'checked',
      )
      await expect(sheet.locator('[data-testid="case-move-up-branch_0"]')).toBeDisabled()
      await expect(sheet.locator('[data-testid="case-move-down-branch_0"]')).toBeDisabled()
    })

    await test.step('Both add buttons offered while no default exists', async () => {
      await expect(sheet.locator('[data-testid="add-case-button"]')).toBeEnabled()
      await expect(sheet.locator('[data-testid="add-default-button"]')).toBeEnabled()
    })
  })

  test('S2: adding cases and the default, and what the DEFAULT card says', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    await sheet.locator('[data-testid="add-case-button"]').click()
    await sheet.locator('[data-testid="add-default-button"]').click()

    await test.step('Two CASE cards then the DEFAULT card, in that order', async () => {
      const badges = sheet.locator('[data-testid^="case-badge-"], [data-testid^="default-badge-"]')
      await expect(badges).toHaveCount(3)
      await expect(badges.nth(0)).toHaveText('CASE')
      await expect(badges.nth(1)).toHaveText('CASE')
      await expect(badges.nth(2)).toHaveText('DEFAULT')
    })

    await test.step('"+ Default" grays out once a default exists', async () => {
      const addDefault = sheet.locator('[data-testid="add-default-button"]')
      await expect(addDefault).toBeDisabled()
      await expect(addDefault).toHaveClass(/opacity-50/)
      await expect(addDefault).toHaveClass(/cursor-not-allowed/)
    })

    await test.step('The DEFAULT card has no Break and no reorder, but can be deleted', async () => {
      const defaultCard = sheet.locator('[data-testid^="default-card-"]')
      await expect(defaultCard).toHaveCount(1)
      await expect(defaultCard.locator('[data-testid^="case-break-"]')).toHaveCount(0)
      await expect(defaultCard.locator('[data-testid^="default-move-up-"]')).toHaveCount(0)
      await expect(defaultCard.locator('[data-testid^="default-move-down-"]')).toHaveCount(0)
      await expect(defaultCard.locator('[data-testid^="default-delete-"]')).toHaveCount(1)
    })

    await test.step('The DEFAULT body states that fall-through reaches it (SWITCH-4)', async () => {
      await expect(sheet.locator('[data-testid^="default-body-"]')).toHaveText(DEFAULT_CAPTION)
    })
  })

  test('S3: a collapsed case keeps its Break switch and grows no extra line', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    const body = sheet.locator('[data-testid="case-body-branch_0"]')
    await expect(body).toBeVisible()

    await sheet.locator('[data-testid="case-toggle-branch_0"]').click()
    await expect(body).toBeHidden()

    const header = sheet.locator('[data-testid="case-header-branch_0"]')
    await expect(header.locator('[data-testid="case-break-branch_0"]')).toBeVisible()
    await expect(header.locator('[data-testid="case-label-branch_0"]')).toBeVisible()
    await expect(header.locator('[data-testid="case-move-up-branch_0"]')).toBeVisible()
    await expect(header.locator('[data-testid="case-delete-branch_0"]')).toBeVisible()

    await test.step('Break toggles off without re-expanding the card', async () => {
      const breakSwitch = sheet.locator('[data-testid="case-break-branch_0"]')
      await breakSwitch.click()
      await expect(breakSwitch).toHaveAttribute('data-state', 'unchecked')
      await expect(body).toBeHidden()
      // SWITCH-9: the Break state is the ONLY fall-through signal - no annotation line.
      const card = sheet.locator('[data-testid="case-card-branch_0"]')
      await expect(card).not.toContainText('fall')
    })
  })

  test('S4: a blocked Save says why, collapsed or not (5.1 fix)', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    // A brand new case starts with no assertions, which blocks Save.
    await sheet.locator('[data-testid="add-case-button"]').click()
    const newCard = sheet.locator('[data-testid^="case-card-"]').nth(1)
    const branchId = await newCard.evaluate(
      (el) => (el.getAttribute('data-testid') ?? '').replace('case-card-', ''),
    )
    const body = sheet.locator(`[data-testid="case-body-${branchId}"]`)
    const marker = sheet.locator(`[data-testid="case-alert-${branchId}"]`)

    await test.step('The empty body states the requirement and Save is refused', async () => {
      await expect(body.locator('[data-testid="assertion-builder-empty"]')).toHaveText(
        'At least one assertion is required',
      )
      await expect(body.locator('[data-testid="assertion-builder-empty"]')).toHaveClass(
        /text-destructive/,
      )
      await expect(marker).toBeVisible()
      await expect(saveButton(sheet)).toBeDisabled()
    })

    await test.step('Collapsing the card keeps the marker, and it names the reason', async () => {
      await sheet.locator(`[data-testid="case-toggle-${branchId}"]`).click()
      await expect(body).toBeHidden()
      await expect(marker).toBeVisible()
      await marker.hover()
      await expect(marker).toHaveAttribute('data-state', /open/, { timeout: 5_000 })
      // Read the popup this marker owns rather than whatever tooltip is on screen.
      const describedBy = await marker.getAttribute('aria-describedby')
      expect(describedBy, 'the marker must point at its own tooltip').toBeTruthy()
      await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
        'This case has no assertions - Save stays blocked until it has one',
        { timeout: 5_000 },
      )
    })

    await test.step('Completing the case clears the marker and unlocks Save', async () => {
      await sheet.locator(`[data-testid="case-toggle-${branchId}"]`).click()
      await expect(body).toBeVisible()
      await addLiteralRow(body)
      await pickConditionVariable(page, body, '0', 'mode')
      await expect(marker).toHaveCount(0)
      await expect(body.locator('[data-testid="assertion-builder-empty"]')).toHaveCount(0)
      await expect(saveButton(sheet)).toBeEnabled()
    })
  })

  test('S5: half-built conditions must not save (5.1 fix)', async ({ page }) => {
    const testId = await seedAndOpen(page)
    const sheet = await openConfig(page)

    const body = sheet.locator('[data-testid="case-body-branch_0"]')
    await expect(body).toBeVisible()

    await test.step('A literal row with no variable outlines red and refuses Save', async () => {
      await addLiteralRow(body)
      const anchor = body.locator('[data-testid="assert-variable-2"]')
      await expect(anchor).toHaveAttribute('aria-invalid', 'true')
      await expect(saveButton(sheet)).toBeDisabled()
    })

    await test.step('Picking the variable clears the outline and unlocks Save', async () => {
      await pickConditionVariable(page, body, '2', 'mode')
      await expect(body.locator('[data-testid="assert-variable-2"]')).not.toHaveAttribute(
        'aria-invalid',
        'true',
      )
      await expect(saveButton(sheet)).toBeEnabled()
    })

    await test.step('An empty expression row outlines red and refuses Save', async () => {
      await addExpressionRow(body)
      const exprRow = body.locator('[data-testid="assert-expression-input-4"]')
      await expect(exprRow.locator('[class*="border-destructive"]').first()).toBeVisible()
      await expect(saveButton(sheet)).toBeDisabled()
    })

    await test.step('Typing the expression unlocks Save, and only complete rows persist', async () => {
      const exprRow = body.locator('[data-testid="assert-expression-input-4"]')
      await exprRow.locator('.cm-content').first().click()
      await page.keyboard.type('mode == "go"')
      await expect(saveButton(sheet)).toBeEnabled()

      await saveButton(sheet).click()
      await expect(sheet).toBeHidden({ timeout: 10_000 })

      const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
      await expect(toolbarSave).toBeEnabled({ timeout: 10_000 })
      await toolbarSave.click()
      await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })

      const branches = await persistedBranches(page, testId)
      const conditions = (branches[0]?.conditions ?? []) as Array<Record<string, unknown>>
      const rows = conditions.filter((c) => c.type !== 'operator')
      expect(rows.length, `persisted rows: ${JSON.stringify(rows)}`).toBe(3)
      for (const row of rows) {
        if (row.type === 'literal') {
          expect(
            String(row.variable ?? '').trim().length,
            `a saved literal condition must name a variable: ${JSON.stringify(row)}`,
          ).toBeGreaterThan(0)
        } else {
          expect(
            String(row.expression ?? '').trim().length,
            `a saved expression condition must carry text: ${JSON.stringify(row)}`,
          ).toBeGreaterThan(0)
        }
      }
    })
  })
})
