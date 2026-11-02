/**
 * V-FN-BLOCK-NAMELESS-IMPORT-FUNCTIONAL: a nameless Block inside a Local Function imports under its type's name
 * Wireframe: none (functional)
 * Design Decisions: EXEC-25, EXEC-26
 * REQ: REQ-3.1.2.4, REQ-3.1.1.4
 *
 * Seeds: `fixture-fn-block-nameless.json`, a Test whose Local Function `Loop_Fn` holds a For Loop with an
 * empty Name (count 2, its index bound to the local `i`) and a body Log printing `'iter-' + str(i)`. It is
 * imported through the Tests page Import dialog under a unique `zz-11541-s7-` name and deleted afterwards.
 *
 * Pass Criteria:
 * 1. The import stores the Test, and the For Loop in the Local Function body is stored named `For Loop`.
 * 2. The stored Test passes the save check with zero errors.
 * 3. Drilled into the Function, the Block reads `For Loop` on the canvas.
 * 4. The run passes and the loop's body prints `iter-0` and `iter-1`.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { importedTestId, importThroughListPage } from '../../helpers/fixture-import'
import { openTest, validateTest } from '../../helpers/fn-seed'
import { cleanUp, storedBlock, zzName } from '../../helpers/fn-block'
import { readFixture } from '../../helpers/element-types'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import {
  breadcrumbFunctionSegments,
  digIn,
  popToBreadcrumbSegment,
  runToEnd,
  selectEnvironment,
} from '../../helpers/workbench'

const FN_ID = '8a95b70d-c305-42c7-bdc7-a6abd4d33f0a'
const FOR_ID = '6e9d0a6c-eca4-405a-97c1-0136193d4656'

test.describe('V-FN-BLOCK-NAMELESS-IMPORT-FUNCTIONAL: a nameless Block in a Function flow', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('a Local Function body Block with an empty Name imports named after its type and runs', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const name = zzName('nameless')
    const fixture = { ...readFixture(__dirname, 'fixture-fn-block-nameless.json'), name }

    await test.step('the import stores the For Loop under its type name', async () => {
      await importThroughListPage(page, '/tests', {
        name: 'nameless-loop.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(fixture)),
      })
      testIds.push(await importedTestId(page, name))
      const loop = await storedBlock(request, testIds[0], FN_ID, FOR_ID)
      expect(loop.label).toBe('For Loop')
      expect((await validateTest(request, testIds[0], 'run')).errors).toHaveLength(0)
    })

    await test.step('the canvas names the Block after its type', async () => {
      await openTest(page, testIds[0])
      await digIn(page, FN_ID)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
      await expect(page.getByTestId(`workflow-node-body-${FOR_ID}`)).toHaveAttribute('aria-label', 'For Loop block')
    })

    await test.step('the imported Test runs the loop', async () => {
      await popToBreadcrumbSegment(page, name)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, formatEntries(entries)).toBe('passed')
      expectConsoleLine(entries, 'INFO', 'iter-0')
      expectConsoleLine(entries, 'INFO', 'iter-1')
    })
  })
})
