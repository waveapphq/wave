/**
 * V-BINDING-NAME-GATE-FUNCTION (functional): the Function instance config modal
 * gates output binding names the same way a Block config sheet does.
 *
 * The two surfaces are different components that share only the row table, so
 * the gate is proved here separately from the Block sheet.
 *
 * Pass Criteria:
 *   1. Typing a name that fails the variable-name rule into a Function
 *      output's "Assign to" field shows the reason under the row, wires
 *      aria-describedby from the input to that message, marks the input
 *      invalid, shuts the suggestion list, and disables Save.
 *   2. One Backspace makes the name valid: the message is gone, the input no
 *      longer points at it, the suggestion list is back with no further
 *      keystroke, and Save is enabled.
 *   3. A stale binding left over for an output the Function no longer declares
 *      cannot block Save invisibly: it renders no row and no message, and Save
 *      is enabled as soon as a real edit is made.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { configSheet, openBlockSheet } from '../../helpers/workbench'
import {
  createValidTest,
  dismissLoadDialogIfPresent,
  localFunctionNode,
  logNode,
  openTest,
  rawPersistTest,
  startEdge,
} from '../../helpers/fn-seed'

const NODE_ID = 'binding-gate-fn'
const ROW = '[data-testid="output-row-result"]'
const ERROR = '[data-testid="field-error-result"]'
const POPPER = '[data-radix-popper-content-wrapper]'
const SUGGESTION_LIST = `${POPPER} [data-slot="command-list"]`

const INVALID_NAME_ERROR =
  "'k8s-' is not a valid variable name (use letters, digits, underscores; must not start with a digit)"

/** A Local Function declaring one string output, with the given stored bindings. */
function functionNode(outputBindings: Record<string, string>): Record<string, unknown> {
  const node = localFunctionNode(NODE_ID, 'Gate Function', {
    nodes: [logNode('inner-log', 'Log', "'gate-body'")],
    edges: [startEdge('inner-log')],
    outputs: [{ name: 'result', type: 'string' }],
  })
  const data = node.data as Record<string, unknown>
  data.config = { values: {}, outputBindings, profileBindings: [] }
  return node
}

/** Open the Function instance config modal through the node's cog. */
async function openModal(page: Page): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${NODE_ID}"]`)
  await expect(node).toBeVisible({ timeout: 15_000 })
  await openBlockSheet(page, NODE_ID)
  const modal = configSheet(page)
  await expect(modal).toBeVisible({ timeout: 10_000 })
  await modal.locator(ROW).scrollIntoViewIfNeeded()
  await page.mouse.move(4, 4)
  return modal
}

test.describe('V-BINDING-NAME-GATE-FUNCTION (functional): output binding name gate on the Function modal', () => {
  test('an invalid name shows the reason under the row, wires the description reference and disables Save', async ({
    page,
    request,
  }) => {
    const testId = await createValidTest(request, {
      name: `V-BINDING-NAME-GATE-FUNCTION ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nodes: [functionNode({})],
      edges: [startEdge(NODE_ID)],
    })
    await openTest(page, testId)
    const modal = await openModal(page)

    const combobox = modal.locator(`${ROW} [role="combobox"]`).first()
    const save = modal.getByRole('button', { name: 'Save', exact: true })

    await combobox.click()
    await combobox.fill('k8s-')
    // Park the pointer so no hover layer of any kind is on screen.
    await page.mouse.move(4, 4)

    const fieldError = modal.locator(ERROR)
    await expect(fieldError).toBeVisible()
    await expect(fieldError).toHaveAttribute('role', 'alert')
    await expect(fieldError).toHaveText(INVALID_NAME_ERROR)
    const errorId = await fieldError.getAttribute('id')
    expect(errorId, 'the error under the field carries an id').toBeTruthy()
    await expect(combobox).toHaveAttribute('aria-describedby', errorId as string)
    await expect(combobox).toHaveAttribute('aria-invalid', 'true')

    // The suggestion list is shut, so nothing covers the message.
    await expect(page.locator(POPPER)).toHaveCount(0)
    await expect(page.getByTestId('output-binding-footer')).toHaveCount(0)
    await expect(combobox).toHaveAttribute('aria-expanded', 'false')

    await expect(save).toBeDisabled()

    // One Backspace - no click, no refocus, no reopen keystroke.
    await combobox.press('Backspace')

    await expect(modal.locator(ERROR)).toHaveCount(0)
    await expect(combobox).not.toHaveAttribute('aria-describedby')
    await expect(combobox).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator(SUGGESTION_LIST)).toBeVisible()
    await expect(combobox).toHaveAttribute('aria-expanded', 'true')
    await expect(save).toBeEnabled()
  })

  test('a stale binding for an output that no longer exists cannot block Save invisibly', async ({
    page,
    request,
  }) => {
    // `dropped_output` is not declared by the Function any more, and the name
    // it still points at could never be written to. Neither fact may reach Save.
    const testId = await rawPersistTest(request, {
      name: `V-BINDING-NAME-GATE-FUNCTION stale ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nodes: [functionNode({ result: '', dropped_output: 'k8s-' })],
      edges: [startEdge(NODE_ID)],
    })
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)
    const modal = await openModal(page)

    // The dropped output has no row, so it can carry no visible message.
    await expect(modal.locator('[data-testid="output-row-dropped_output"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="field-error-dropped_output"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid^="field-error-"]')).toHaveCount(0)

    const combobox = modal.locator(`${ROW} [role="combobox"]`).first()
    const save = modal.getByRole('button', { name: 'Save', exact: true })

    await combobox.click()
    await combobox.fill('gate_result')

    await expect(modal.locator('[data-testid^="field-error-"]')).toHaveCount(0)
    await expect(save).toBeEnabled()

    // Esc closes the suggestion list without closing the modal.
    await combobox.press('Escape')
    await expect(modal).toBeVisible()
    await expect(page.locator(SUGGESTION_LIST)).toHaveCount(0)

    await save.click()
    await expect(modal).toBeHidden({ timeout: 10_000 })
  })
})
