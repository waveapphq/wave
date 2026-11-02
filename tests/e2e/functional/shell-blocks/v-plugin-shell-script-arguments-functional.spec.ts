/**
 * SH-1: Shell Script argument order after reordering with the arrows
 * Design Decisions: SHRUN-4, FIELD-10
 * REQ: REQ-3.4.1.1
 *
 * Pass Criteria:
 * 1. The Arguments row's expand opens the shared list editor on $1 `one`, $2 `two words`, $3 `arg3`
 *    (expression); after "Move argument $3 up" then "Move argument $1 down" the items read $1 `arg3`
 *    (expression), $2 `one`, $3 `two words`.
 * 2. The persisted node holds `arguments` exactly `[{value: "arg3"}, {value: "one"},
 *    {value: "two words"}]` and `expressionFields` exactly `["arguments.0.value"]`.
 * 3. The run passes, `sh-args` paints success, and `args_out` lines are exactly
 *    `three|one|two words` and `n=3`.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { startRun, finishRun, expectNodeStatus } from '../../helpers/k8s-run'
import {
  editPreview,
  listItems,
  listMoveDown,
  listMoveUp,
  openListEditor,
  saveListEditor,
} from '../../helpers/config-sheet'
import { listItem } from '../../helpers/entry-editors'
import {
  deleteTest,
  expandGroup,
  openConfig,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import { newToken, stripOneNewline, withToken } from './shell-helpers'

const NODE = 'sh-args'

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-arguments.json'), 'utf-8'))
  return withToken(raw, token)
}

/** Assert one item of the list editor: its `$n` position, its value and whether it is an expression. */
async function expectArgumentRow(
  editor: Locator,
  index: number,
  value: string,
  isExpression: boolean,
): Promise<void> {
  await expect(listItems(editor).nth(index)).toHaveText(`$${index + 1}`)
  const toggle = listItem(editor, index).exprToggle
  if (isExpression) {
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(listItem(editor, index).exprBox.locator('.cm-content')).toHaveText(value)
    await expect(listItem(editor, index).valueInput).toHaveCount(0)
  } else {
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(listItem(editor, index).valueInput).toHaveValue(value)
    await expect(listItem(editor, index).exprBox.locator('.cm-content')).toHaveCount(0)
  }
}

test.describe('SH-1: Shell Script arguments reach the script in row order', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('SH-1 reordered arguments run and persist in the new order', async ({ page }: { page: Page }) => {
    test.setTimeout(180_000)
    const token = newToken()
    testId = await importValidateAndNavigate(page, loadFixture(token))

    await test.step('reorder the items with the arrows in the list editor', async () => {
      const dialog = await openConfig(page, NODE)
      await expandGroup(dialog, 'Script')
      await expect(editPreview(dialog, 'arguments')).toHaveValue('["one", "two words", {{ arg3 }}]')
      const editor = await openListEditor(page, dialog, 'arguments')
      await expect(listItems(editor)).toHaveCount(3)
      await expectArgumentRow(editor, 0, 'one', false)
      await expectArgumentRow(editor, 1, 'two words', false)
      await expectArgumentRow(editor, 2, 'arg3', true)

      const moveThreeUp = listMoveUp(editor, 2)
      await expect(moveThreeUp).toHaveAccessibleName('Move argument $3 up')
      await moveThreeUp.click()
      const moveOneDown = listMoveDown(editor, 0)
      await expect(moveOneDown).toHaveAccessibleName('Move argument $1 down')
      await moveOneDown.click()

      await expectArgumentRow(editor, 0, 'arg3', true)
      await expectArgumentRow(editor, 1, 'one', false)
      await expectArgumentRow(editor, 2, 'two words', false)

      await saveListEditor(editor)
      await expect(editPreview(dialog, 'arguments')).toHaveValue('[{{ arg3 }}, "one", "two words"]')
      await saveConfig(dialog)
      await saveWorkbench(page)
    })

    await test.step('the persisted node holds the new order and its expression entry', async () => {
      const node = (await persistedNodes(page.request, testId as string))[NODE]
      expect(node.config.values.arguments).toEqual([
        { value: 'arg3' },
        { value: 'one' },
        { value: 'two words' },
      ])
      expect(node.expressionFields).toEqual(['arguments.0.value'])
    })

    await test.step('the run passes and the script saw $1..$3 in row order', async () => {
      const status = await startRun(page)
      await finishRun(page, status, `SH-1-done-${token}`)
      await expectNodeStatus(page, NODE, 'success')
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      const out = stripOneNewline(String(variables.args_out.value))
      expect(out.split('\n')).toEqual(['three|one|two words', 'n=3'])
    })
  })
})
