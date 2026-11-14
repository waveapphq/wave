/**
 * V-SHEET-DIALOG (functional): floating windows are non-modal dialogs named by their titles.
 *
 * Design Decisions: CANVAS-227, VMGR-15, VMGR-106
 * REQ: REQ-5.2.1.32, REQ-5.2.1.33
 *
 * Pass Criteria:
 * 1. The variable window opened from `+ Add` is a dialog named `New variable`, marked not modal,
 *    and the cursor is in its Name field; it keeps the page's text color and adds no margin or padding.
 * 2. The window the row pencil opens is a dialog named `Edit variable` with the cursor in Name,
 *    which holds the saved name.
 * 3. A watcher is a dialog named by its title, the variable's name, and is marked not modal.
 * 4. The page behind stays usable: its `Add` button is still found by its role and opens another
 *    window while the others are open.
 * 5. Escape still closes only the window in front.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { logNode, startEdge } from '../../helpers/fn-seed'
import { editPencil, expandVariableManager, variableRow } from '../../helpers/variable-create'

const NAME_FIELD = 'create-variable-name'

function fixture(): Record<string, unknown> {
  return {
    name: 'V-SHEET-DIALOG',
    version: '1.0.0',
    description: 'floating windows as named dialogs',
    workflow: {
      nodes: [logNode('log-count', 'Read Count', 'f"count={counter}"', { x: 200, y: 140 })],
      edges: [startEdge('log-count')],
    },
    variables: { counter: { value: 3, type: 'integer', scope: 'test' } },
    metadata: {},
  }
}

test.describe('V-SHEET-DIALOG: floating windows are named non-modal dialogs', () => {
  test('the variable window and a watcher are named by their titles; the cursor starts in Name', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, fixture())
    await expandVariableManager(page)

    const addButton = page
      .getByTestId('variable-manager-content')
      .getByRole('button', { name: 'Add', exact: true })
    await addButton.click()
    const created = page.getByRole('dialog', { name: 'New variable', exact: true })
    await expect(created).toBeVisible()
    await expect(created).toHaveAttribute('aria-modal', 'false')
    await expect(created.getByTestId(NAME_FIELD)).toBeFocused()
    // The window keeps the page's text color and adds no margin or padding of its own.
    const look = await created.evaluate((el) => {
      const own = getComputedStyle(el)
      return { color: own.color, inherited: getComputedStyle(el.parentElement as Element).color, margin: own.margin, padding: own.padding }
    })
    expect(look.color).toBe(look.inherited)
    expect(look.margin).toBe('0px')
    expect(look.padding).toBe('0px')

    await editPencil(page, 'counter').click()
    const edited = page.getByRole('dialog', { name: 'Edit variable', exact: true })
    await expect(edited).toBeVisible()
    await expect(edited).toHaveAttribute('aria-modal', 'false')
    await expect(edited.getByTestId(NAME_FIELD)).toBeFocused()
    await expect(edited.getByTestId(NAME_FIELD)).toHaveValue('counter')

    await variableRow(page, 'counter').locator('[data-testid^="expand-button-"]').click()
    const watcher = page.getByRole('dialog', { name: 'counter', exact: true })
    await expect(watcher).toBeVisible()
    await expect(watcher).toHaveAttribute('aria-modal', 'false')

    // The page behind is neither hidden from assistive technology nor blocked.
    await addButton.click()
    await expect(page.getByRole('dialog', { name: 'New variable', exact: true })).toHaveCount(2)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'New variable', exact: true })).toHaveCount(1)
    await expect(watcher).toBeVisible()
    await expect(edited).toBeVisible()
  })
})
