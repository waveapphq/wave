/**
 * V-FN-BLOCK-FLOW-RULES-FUNCTIONAL: inside a Function flow a Block may not write a Function input nor read an outer scope
 * Wireframe: none (functional)
 * Design Decisions: FIELDERR-3, CANVAS-211
 * REQ: REQ-3.1.2.4, REQ-3.1.2.1
 *
 * Seeds (API, the admin bulk route, which stores a Test without its save check, because both rules refuse a
 * save): a `zz-11541-s7-` Test with a Local Function `Rules_Fn` (Integer input `x`, given 7 by its Function
 * Block; local `count`) whose flow holds a CSV Parser binding its Row Count to `x` and a Log printing
 * `str(suite.x)`. The fixes, the Save and the run are made through the UI.
 *
 * Pass Criteria:
 * 1. The save check reports `INPUT_WRITE_FORBIDDEN` `Writes to declared input 'x'; inputs are read-only` and
 *    `EXTERNAL_SCOPE_READ_FORBIDDEN` `Reads variable 'x' from external scope 'suite'; only the Function's own
 *    scope is visible`.
 * 2. Drilled into the Function flow, the CSV Parser's alert badge lists the read-only message and the Log's
 *    badge lists the outer-scope message.
 * 3. The Log reading `str(x)` and the CSV Parser writing the local `count` lose their badges; the Test then
 *    saves and its run passes, printing `7`.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { bindOutput } from '../../helpers/config-sheet'
import { dismissLoadDialogIfPresent, openTest, rawPersistTest, validateTest } from '../../helpers/fn-seed'
import {
  alertBadge,
  badgeMessages,
  chainEdges,
  cleanUp,
  configOf,
  csvBlock,
  fieldCode,
  localFunctionBlock,
  logBlock,
  openBlockWindow,
  replaceCode,
  saveBlockWindow,
  storedBlock,
  zzName,
} from '../../helpers/fn-block'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import {
  breadcrumbFunctionSegments,
  digIn,
  popToBreadcrumbSegment,
  runToEnd,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'

const FN_ID = 'fn-rules'
const CSV_ID = 'rules-csv'
const LOG_ID = 'rules-log'
const WRITES_INPUT = "Writes to declared input 'x'; inputs are read-only"
const READS_OUTER = "Reads variable 'x' from external scope 'suite'; only the Function's own scope is visible"

test.describe("V-FN-BLOCK-FLOW-RULES-FUNCTIONAL: a Function flow's read-only and scope rules", () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('a Block writing a Function input or reading suite.x is flagged until fixed, then the Function runs', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const name = zzName('flow-rules')
    const testId = await rawPersistTest(request, {
      name,
      nodes: [
        localFunctionBlock(
          FN_ID,
          'Rules_Fn',
          {
            inputs: [{ name: 'x', type: 'integer', required: false, default: null, description: '' }],
            variables: [{ name: 'count', type: 'integer', value: 0 }],
            nodes: [
              csvBlock(CSV_ID, 'Count Rows', { outputBindings: { row_count: 'x' }, position: { x: 200, y: 140 } }),
              logBlock(LOG_ID, 'Read Outer', 'str(suite.x)', { position: { x: 200, y: 300 } }),
            ],
          },
          { values: { x: 7 } },
        ),
      ],
      edges: chainEdges([FN_ID]),
    })
    testIds.push(testId)

    await test.step('the save check names both rules', async () => {
      const result = await validateTest(request, testId)
      const messages = (code: string) => result.errors.filter((e) => e.code === code).map((e) => e.message)
      expect(messages('INPUT_WRITE_FORBIDDEN'), JSON.stringify(result.errors)).toEqual([WRITES_INPUT])
      expect(messages('EXTERNAL_SCOPE_READ_FORBIDDEN'), JSON.stringify(result.errors)).toEqual([READS_OUTER])
    })

    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)
    await digIn(page, FN_ID)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)

    await test.step('each Block carries its rule on the canvas badge', async () => {
      expect(await badgeMessages(page, CSV_ID)).toContain(WRITES_INPUT)
      expect(await badgeMessages(page, LOG_ID)).toContain(READS_OUTER)
    })

    await test.step('reading the input and writing a local clear the badges', async () => {
      const log = await openBlockWindow(page, LOG_ID)
      await replaceCode(page, fieldCode(log, 'message'), 'str(x)')
      await saveBlockWindow(log)
      await expect(alertBadge(page, LOG_ID)).toHaveCount(0)

      const csv = await openBlockWindow(page, CSV_ID)
      await bindOutput(csv, 'row_count', 'count')
      await saveBlockWindow(csv)
      await expect(alertBadge(page, CSV_ID)).toHaveCount(0)
    })

    await test.step('the fixed Test saves and runs', async () => {
      await popToBreadcrumbSegment(page, name)
      await expect(alertBadge(page, FN_ID)).toHaveCount(0)
      await saveTest(page)
      expect(configOf(await storedBlock(request, testId, FN_ID, CSV_ID)).outputBindings).toEqual({ row_count: 'count' })
      expect(configOf(await storedBlock(request, testId, FN_ID, LOG_ID)).values).toMatchObject({ message: 'str(x)' })
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, formatEntries(entries)).toBe('passed')
      expectConsoleLine(entries, 'INFO', '7')
    })
  })
})
