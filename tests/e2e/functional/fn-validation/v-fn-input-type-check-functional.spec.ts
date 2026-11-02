/**
 * V-FN-INPUT-TYPE-CHECK-FUNCTIONAL: an Integer Function input given text by an expression is refused before the Function flow runs
 * Wireframe: none (functional)
 * Design Decisions: FNCFG-6, CANVAS-211
 * REQ: REQ-3.1.2.1, REQ-3.1.3.21, REQ-3.1.1.5
 *
 * Seeds (API, POST /tests): a `zz-11541-s7-` Test with the variable `label_text` (string `abc`) and a Local
 * Function `Typed_Fn` with the Required Integer input `n`, given the literal 3 by its Function Block; the
 * body Log prints `'n=' + str(n)`. The expression edits, the Saves and the runs are made through the UI.
 *
 * Pass Criteria:
 * 1. Switching `n` to {x} while it holds 3 asks first; Clear, then `label_text`, saves and stores `n` as
 *    the expression `label_text` flagged in `expressionFields`.
 * 2. The run fails at the Function Block: the console carries `Entering Function 'Typed_Fn'` and then
 *    `Function 'Typed_Fn' completed with status failed: Parameter 'n' expects integer, got str`, the body
 *    Log never prints, and the Function Block is failed.
 * 3. With `len(label_text)`, which gives an integer, the same Function runs and prints `n=3`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openTest, validateTest } from '../../helpers/fn-seed'
import {
  cleanUp,
  configOf,
  createTest,
  fieldCode,
  fieldToggle,
  localFunctionBlock,
  logBlock,
  openBlockWindow,
  replaceCode,
  saveBlockWindow,
  storedBlock,
  zzName,
} from '../../helpers/fn-block'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, expectLineBefore, formatEntries } from '../../helpers/log-reader'
import { resetRun, runToEnd, saveTest, selectEnvironment } from '../../helpers/workbench'

const FN_ID = 'fn-typed'
const ENTERING = "Entering Function 'Typed_Fn'"
const REFUSED = "Function 'Typed_Fn' completed with status failed: Parameter 'n' expects integer, got str"

/** Give `n` a new expression in the Function Block window and save the window and the Test. */
async function setExpression(page: Page, expression: string): Promise<void> {
  const sheet = await openBlockWindow(page, FN_ID)
  await replaceCode(page, fieldCode(sheet, 'n'), expression)
  await saveBlockWindow(sheet)
  await saveTest(page)
}

test.describe('V-FN-INPUT-TYPE-CHECK-FUNCTIONAL: a Function input is type-checked before its flow runs', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('an Integer input bound to text fails the Function Block before its body runs', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testId = await createTest(request, {
      name: zzName('type-check'),
      variables: { label_text: { type: 'string', value: 'abc', scope: 'test' } },
      nodes: [
        localFunctionBlock(
          FN_ID,
          'Typed_Fn',
          {
            inputs: [{ name: 'n', type: 'integer', required: true, description: '' }],
            nodes: [logBlock('typed-log', 'Print N', "'n=' + str(n)")],
          },
          { values: { n: 3 } },
        ),
      ],
    })
    testIds.push(testId)
    expect((await validateTest(request, testId, 'run')).errors).toHaveLength(0)
    await openTest(page, testId)

    await test.step('n switches to {x} after the question and stores the expression', async () => {
      const sheet = await openBlockWindow(page, FN_ID)
      await fieldToggle(sheet, 'n').click()
      const question = page.getByTestId('switch-mode-dialog')
      await expect(question).toBeVisible()
      await expect(question.getByRole('heading')).toHaveText('Switch the field to an expression?')
      await question.getByTestId('switch-mode-clear-default').click()
      await expect(question).toHaveCount(0)
      await expect(fieldToggle(sheet, 'n')).toHaveAttribute('aria-pressed', 'true')
      await replaceCode(page, fieldCode(sheet, 'n'), 'label_text')
      await saveBlockWindow(sheet)
      await saveTest(page)
      const block = await storedBlock(request, testId, FN_ID)
      expect(configOf(block).values).toEqual({ n: 'label_text' })
      expect(block.expressionFields).toEqual(['n'])
    })

    await test.step('the run refuses the text before the Function flow runs', async () => {
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, formatEntries(entries)).toBe('failed')
      expectLineBefore(entries, ENTERING, REFUSED)
      expectConsoleLine(entries, 'ERROR', REFUSED)
      expect(entries.filter((entry) => entry.message.startsWith('n=')), formatEntries(entries)).toEqual([])
      await expectNodeStatus(page, FN_ID, 'failed')
    })

    await test.step('an expression giving an integer runs the same Function', async () => {
      await resetRun(page)
      await setExpression(page, 'len(label_text)')
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, formatEntries(entries)).toBe('passed')
      expectConsoleLine(entries, 'INFO', 'n=3')
      expect(entries.some((entry) => entry.message === REFUSED), formatEntries(entries)).toBe(false)
    })
  })
})
