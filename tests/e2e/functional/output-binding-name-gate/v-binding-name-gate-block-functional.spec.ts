/**
 * V-BINDING-NAME-GATE-BLOCK (functional): the "Assign to" suggestion list on a
 * Block config sheet must never cover the invalid-name error.
 *
 * Shared surface: every Block's output binding row uses the same combobox, so
 * this guards all of them, not one plugin.
 *
 * Pass Criteria:
 *   1. Clicking an empty "Assign to" field still opens the suggestion list.
 *   2. While the typed name fails the variable-name rule: no popover layer
 *      anywhere on the page, no dropdown footer, no "new variable" hint, no
 *      "No matching variables" text, aria-expanded is false, the input is
 *      marked invalid and points at the error through aria-describedby, the
 *      whole error sentence is on screen and nothing overlaps it, and Save is
 *      disabled.
 *   3. One Backspace makes the name valid again: the list comes back with no
 *      further keystroke, the error is gone, the input no longer points at it,
 *      and Save is enabled.
 *   4. A TYPE-MISMATCH error leaves the list OPEN and
 *      selectable - the suppression keys on name syntax only. Picking a
 *      type-compatible variable from that open list clears the error and
 *      re-enables Save.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { configSheet, openBlockSheet } from '../../helpers/workbench'
import { createValidTest, openTest } from '../../helpers/fn-seed'

const NODE_ID = 'binding-gate-http'
const ROW = '[data-testid="output-row-status_code"]'
const ERROR = '[data-testid="field-error-status_code"]'
const POPPER = '[data-radix-popper-content-wrapper]'
const SUGGESTION_LIST = `${POPPER} [data-slot="command-list"]`

const INVALID_NAME_ERROR =
  "'k8s-' is not a valid variable name (use letters, digits, underscores; must not start with a digit)"

function httpNode(): Record<string, unknown> {
  return {
    id: NODE_ID,
    type: 'workflowNode',
    position: { x: 300, y: 200 },
    data: {
      label: 'HTTP Client',
      elementType: 'http-client',
      nodeType: 'plugin',
      category: 'network',
      version: '1.0.0',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { method: 'GET', url: 'https://example.com/binding-gate', response_mode: 'body' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

async function seedTest(request: APIRequestContext): Promise<string> {
  return createValidTest(request, {
    name: `V-BINDING-NAME-GATE-BLOCK ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nodes: [httpNode()],
    edges: [{ id: `e-start-${NODE_ID}`, source: 'start-node', target: NODE_ID }],
    variables: {
      gate_code: { value: 0, type: 'integer', scope: 'test' },
      gate_text: { value: 'x', type: 'string', scope: 'test' },
    },
  })
}

/** Open the Block config sheet through the node's cog and settle the pointer. */
async function openSheet(page: Page): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${NODE_ID}"]`)
  await expect(node).toBeVisible({ timeout: 15_000 })
  await openBlockSheet(page, NODE_ID)
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  await sheet.locator(ROW).scrollIntoViewIfNeeded()
  await page.mouse.move(4, 4)
  return sheet
}

/** 'self' when the element itself is the topmost thing at its own center. */
async function topmostAtCenter(target: Locator): Promise<string> {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    if (!hit) return 'nothing'
    if (hit === el || el.contains(hit)) return 'self'
    const tag = hit.tagName.toLowerCase()
    const testId = hit.closest('[data-testid]')?.getAttribute('data-testid') ?? ''
    return `${tag}${testId ? `[${testId}]` : ''}`
  })
}

test.describe('V-BINDING-NAME-GATE-BLOCK (functional): Assign to name gate on a Block sheet', () => {
  test('an invalid name shuts the list, shows the whole error and disables Save; one Backspace brings the list back', async ({
    page,
    request,
  }) => {
    const testId = await seedTest(request)
    await openTest(page, testId)
    const sheet = await openSheet(page)

    const combobox = sheet.locator(`${ROW} [role="combobox"]`).first()
    const save = sheet.getByRole('button', { name: 'Save', exact: true })

    // Save only lives while something changed, so this edit is what the gate then kills.
    await sheet.locator('[data-testid="element-description-input"]').fill('binding gate')
    await expect(save).toBeEnabled()

    // The empty field still opens the list - the gate must not break the picker.
    await combobox.click()
    await expect(page.locator(SUGGESTION_LIST)).toBeVisible()
    await expect(combobox).toHaveAttribute('aria-expanded', 'true')

    await combobox.fill('k8s-')
    // Park the pointer so no hover layer of any kind is on screen.
    await page.mouse.move(4, 4)

    // Nothing from the dropdown is left on the page.
    await expect(page.locator(POPPER)).toHaveCount(0)
    await expect(page.getByTestId('output-binding-footer')).toHaveCount(0)
    await expect(page.getByTestId('output-new-var-hint')).toHaveCount(0)
    await expect(page.getByText('No matching variables')).toHaveCount(0)
    await expect(combobox).toHaveAttribute('aria-expanded', 'false')

    // The error is the only thing under the input, and it is fully readable.
    const fieldError = sheet.locator(ERROR)
    await expect(fieldError).toBeVisible()
    await expect(fieldError).toHaveAttribute('role', 'alert')
    await expect(fieldError).toHaveText(INVALID_NAME_ERROR)
    expect(
      await topmostAtCenter(fieldError),
      'something is drawn on top of the invalid-name error',
    ).toBe('self')

    // The input is marked invalid and points at that error for a screen reader.
    await expect(combobox).toHaveAttribute('aria-invalid', 'true')
    const errorId = await fieldError.getAttribute('id')
    expect(errorId, 'the error under the field carries an id').toBeTruthy()
    await expect(combobox).toHaveAttribute('aria-describedby', errorId as string)

    await expect(save).toBeDisabled()

    // One Backspace - no click, no refocus, no reopen keystroke.
    await combobox.press('Backspace')

    await expect(page.locator(SUGGESTION_LIST)).toBeVisible()
    await expect(page.getByTestId('output-binding-footer')).toBeVisible()
    await expect(page.getByTestId('output-new-var-hint')).toContainText('k8s')
    await expect(combobox).toHaveAttribute('aria-expanded', 'true')
    await expect(sheet.locator(ERROR)).toHaveCount(0)
    await expect(combobox).not.toHaveAttribute('aria-invalid', 'true')
    await expect(combobox).not.toHaveAttribute('aria-describedby')
    await expect(save).toBeEnabled()
  })

  test('a type-mismatch error leaves the list open and selectable', async ({ page, request }) => {
    const testId = await seedTest(request)
    await openTest(page, testId)
    const sheet = await openSheet(page)

    const combobox = sheet.locator(`${ROW} [role="combobox"]`).first()
    const save = sheet.getByRole('button', { name: 'Save', exact: true })

    // gate_text is a string; status_code is an integer, so this is a type
    // mismatch and NOT a name-syntax rejection.
    await combobox.click()
    await combobox.fill('gate_text')

    const fieldError = sheet.locator(ERROR)
    await expect(fieldError).toBeVisible()
    await expect(fieldError).toContainText('Type mismatch')
    await expect(fieldError).toContainText('gate_text')
    await expect(save).toBeDisabled()

    // The suppression keys on name syntax only: the list stays open, and the
    // type-compatible variable is still there to pick.
    await expect(page.locator(SUGGESTION_LIST)).toBeVisible()
    await expect(combobox).toHaveAttribute('aria-expanded', 'true')
    const compatible = page.getByRole('option', { name: 'gate_code' })
    await expect(compatible).toBeVisible()

    await compatible.click()

    await expect(combobox).toHaveValue('gate_code')
    await expect(sheet.locator(ERROR)).toHaveCount(0)
    await expect(save).toBeEnabled()
  })
})
