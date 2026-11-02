/**
 * V-VARPICK-01: variable picker with a very long name
 *
 * Wireframe: none - the picker's appearance is unchanged from the existing
 * shared combobox; this asserts the overflow behavior against the live
 * component.
 * Design Decisions: VARPICK-1, VARPICK-2
 * REQ: REQ-3.5.1.20 (shared variable picker)
 *
 * Pass Criteria:
 * 1. A 60-character variable name truncates inside the option row instead of
 *    pushing it wider
 * 2. The full name stays reachable through the row's `title`
 * 3. The type pill stays visible and never shrinks away
 * 4. Neither the option list nor the config sheet scrolls horizontally
 * 5. The typed text is a filter, so no character counter appears
 * 6. All of the above hold in both themes
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { toggleTheme } from '../../helpers/theme'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'

const BASE = `http://localhost:${BACKEND_PORT}`

const SWITCH_ID = 'vp-long'
const LONG_NAME = 'threshold_for_the_downstream_service_response_time_in_millis'

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-VARPICK-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'A condition row whose variable list holds a very long name.',
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
            description: 'Picker host',
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
                        id: 'vp-cond',
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
    variables: {
      mode: { value: 'go', type: 'string', scope: 'test' },
      [LONG_NAME]: { value: 250, type: 'integer', scope: 'test' },
    },
    metadata: {},
  }
}

async function seedAndOpen(page: Page): Promise<void> {
  await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  const resp = await page.request.post(`${BASE}/tests`, { data: buildFixture() })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = body.data?.id ?? body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openPicker(page: Page): Promise<{ sheet: Locator; anchor: Locator }> {
  const node = page.locator(`[data-testid="workflow-node-${SWITCH_ID}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await openSelectedBlockSheet(page)
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })

  const anchor = sheet.locator('[data-testid="case-body-branch_0"] [data-testid="assert-variable-0"]')
  await expect(anchor).toBeVisible()
  await anchor.click()
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 5_000 })
  return { sheet, anchor }
}

async function assertPickerFits(page: Page, sheet: Locator, anchor: Locator): Promise<void> {
  const longOption = page.getByRole('option').filter({ hasText: LONG_NAME }).first()
  const nameSpan = longOption.locator('span.font-mono').first()

  await expect(nameSpan).toHaveClass(/truncate/)
  await expect(nameSpan).toHaveClass(/min-w-0/)
  await expect(nameSpan).toHaveClass(/flex-1/)
  // SHELL-7a: the browser's own popup is gone; the shared tooltip carries the
  // full name (hover-proved in `consistency/tooltip-convergence.spec.ts` -
  // hovering an option here would change which row the picker commits).
  await expect(nameSpan).not.toHaveAttribute('title', /.*/)

  const truncated = await nameSpan.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(truncated, 'a 60-character name must be clipped, not laid out at full width').toBeTruthy()

  // The type pill sits beside the name and never collapses.
  const pill = longOption.getByText('integer', { exact: true })
  await expect(pill).toBeVisible()
  await expect(pill).toHaveClass(/flex-shrink-0/)

  // Neither the list nor the sheet gains a horizontal scroll.
  const listOverflow = await longOption.evaluate((el) => {
    const list = el.closest('[cmdk-list]') ?? el.parentElement
    return list ? list.scrollWidth - list.clientWidth : 0
  })
  expect(listOverflow, 'the option list must not scroll horizontally').toBeLessThanOrEqual(1)

  const sheetOverflow = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(sheetOverflow, 'the config sheet must not scroll horizontally').toBeLessThanOrEqual(1)

  // The popover tracks the anchor with a 320 px floor.
  const anchorWidth = await anchor.evaluate((el) => el.getBoundingClientRect().width)
  const popoverWidth = await page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width)
  expect(Math.abs(popoverWidth - Math.max(anchorWidth, 320))).toBeLessThanOrEqual(1)

  // Typing is a filter, never a name, so no counter appears.
  await anchor.fill('threshold_for_the_downstream_service_response_time_in_millis')
  await expect(sheet.locator('[data-testid="assert-variable-0-counter"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
}

async function closeSheet(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: /^Cancel$/ }).click()
  const unsavedClose = page.getByTestId('unsaved-close')
  if (await unsavedClose.isVisible({ timeout: 1_000 }).catch(() => false)) await unsavedClose.click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

test.describe('V-VARPICK-01: long variable names in the shared picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  })

  test('S1: a long name truncates, keeps its type, and overflows nothing - in both themes', async ({
    page,
  }) => {
    await seedAndOpen(page)

    await test.step('In the project theme', async () => {
      const { sheet, anchor } = await openPicker(page)
      await assertPickerFits(page, sheet, anchor)
      await closeSheet(page, sheet)
    })

    await test.step('And again after flipping the theme', async () => {
      const theme = await toggleTheme(page)
      const { sheet, anchor } = await openPicker(page)
      await assertPickerFits(page, sheet, anchor)
      await expect(page.locator('html'), `still in ${theme}`).toHaveAttribute('data-theme', theme)
      await closeSheet(page, sheet)
    })
  })
})
