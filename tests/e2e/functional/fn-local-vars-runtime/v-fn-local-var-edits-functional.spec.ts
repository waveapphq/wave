/**
 * V-FN-LOCAL-VAR-EDITS: a Function's own variable edited with the pencil between block runs.
 * Wireframe: none (functional)
 * Design Decisions: VMGR-19
 * REQ: REQ-3.2.1.5, REQ-3.1.3.12
 *
 * Pass Criteria:
 * 1. A local variable no block writes follows its definition: after a full run, the value
 *    set with the pencil inside the Function is the one the next Run Current prints, and a
 *    second edit is the one the Run Current after it prints.
 * 2. A local variable a block wrote keeps the block's value on the next Run Current after a
 *    pencil edit of its definition.
 * 3. After the run, the row of the edited variable no block writes shows the new value
 *    before any next run starts.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { deleteTest, importValidated, readFixture } from '../../helpers/element-types'
import { openTest } from '../../helpers/fn-seed'
import { selectEnvironment } from '../../helpers/workbench'
import {
  backendSession,
  editWithPencil,
  expectLines,
  openFunction,
  rowEye,
  rowValue,
  runCurrentToEnd,
  runTestToEnd,
} from './fn-adhoc-drive'

const FUNCTION = '2ab818a2-eca5-4810-8408-0e83cc01c636'
const READ_LOCALS = '5d665e3c-49bf-49bb-8d9c-4eb063f24232'
const PLAIN = 'fn_plain'
const KEPT = 'fn_kept'
const PLAIN_SEED = 100
const BLOCK_VALUE = 500
const LINE_PREFIX = 'fn-read:'

/** The line Read Locals prints when the two local variables hold these values. */
const readLine = (plain: number, kept: number): string => `${LINE_PREFIX}${plain}:${kept}`

test.describe('V-FN-LOCAL-VAR-EDITS: a Function local variable edited between block runs', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  /** Import the Test, run it whole, and open the Function with its variables in view. */
  async function runTestThenOpenFunction(page: Page, request: APIRequestContext): Promise<void> {
    testId = await importValidated(request, readFixture(__dirname, 'local-var-edits-fixture.json'))
    await openTest(page, testId)
    await selectEnvironment(page)
    await runTestToEnd(page)
    await expectLines(
      page,
      LINE_PREFIX,
      [readLine(PLAIN_SEED, BLOCK_VALUE)],
      'the full run prints the declared fn_plain and the fn_kept the block wrote',
    )
    await openFunction(page, FUNCTION, READ_LOCALS)
  }

  test('a local variable no block writes takes each pencil edit on the next Run Current', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await runTestThenOpenFunction(page, request)

    await test.step('the first edit is the value the next Run Current reads', async () => {
      await editWithPencil(page, PLAIN, '200')
      await runCurrentToEnd(page, READ_LOCALS)
      await expectLines(
        page,
        LINE_PREFIX,
        [readLine(PLAIN_SEED, BLOCK_VALUE), readLine(200, BLOCK_VALUE)],
        'Run Current reads fn_plain as edited to 200',
      )
    })

    await test.step('a second edit is the value the Run Current after it reads', async () => {
      await editWithPencil(page, PLAIN, '300')
      await runCurrentToEnd(page, READ_LOCALS)
      await expectLines(
        page,
        LINE_PREFIX,
        [readLine(PLAIN_SEED, BLOCK_VALUE), readLine(200, BLOCK_VALUE), readLine(300, BLOCK_VALUE)],
        'Run Current reads fn_plain as edited to 300',
      )
    })
  })

  test('a local variable a block wrote keeps the block value after a pencil edit of its definition', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await runTestThenOpenFunction(page, request)

    await test.step('the edit lands in the definition while the row keeps the block value', async () => {
      await expect(rowValue(page, KEPT)).toHaveText(String(BLOCK_VALUE))
      await editWithPencil(page, KEPT, '6')
      await expect(rowValue(page, KEPT)).toHaveText(String(BLOCK_VALUE))
      await rowEye(page, KEPT).click()
      await expect(rowValue(page, KEPT), 'the definition view shows the edit').toHaveText('6')
    })

    await test.step('Run Current still reads the value the block wrote', async () => {
      await runCurrentToEnd(page, READ_LOCALS)
      await expectLines(
        page,
        LINE_PREFIX,
        [readLine(PLAIN_SEED, BLOCK_VALUE), readLine(PLAIN_SEED, BLOCK_VALUE)],
        'Run Current reads the 500 the block wrote, not the edited definition 6',
      )
    })
  })

  test('the row of an edited local variable shows the new value before the next run starts', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await runTestThenOpenFunction(page, request)
    const afterRun = await backendSession(page)

    await expect(rowValue(page, PLAIN)).toHaveText(String(PLAIN_SEED))
    await editWithPencil(page, PLAIN, '200')

    await expect(rowValue(page, PLAIN), 'the row shows the edit').toHaveText('200')
    await expect(
      rowEye(page, PLAIN).locator('svg.lucide-eye'),
      'the row is still in its live view, not switched to the definition view',
    ).toBeVisible()
    expect(await backendSession(page), 'no run started since the full run').toEqual(afterRun)
  })
})
