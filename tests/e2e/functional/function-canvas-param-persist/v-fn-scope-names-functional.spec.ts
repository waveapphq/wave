/**
 * V-FN-SCOPE-NAMES-FUNCTIONAL: inside a Function flow a Function Block's expressions see the enclosing Function's names
 * Wireframe: none (functional)
 * Design Decisions: CANVAS-211, FNCFG-9, FIELDERR-3
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.1.2.4
 *
 * Seeds (API, the admin bulk route, which stores a Test without its save check, because a nested Function
 * Block that leaves a Required input empty is refused at save): a `zz-11541-s7-` Test with the root
 * variable `test_var`, and a Local Function `Outer_Fn` (input `in_a`, given `A` by its Function Block;
 * output `out_b` with the default `B`; local `loc_c` = `L`) whose flow holds two nested Local Function
 * Blocks: `Inner_Ok` (Required input `x`, optional input `y`, its body prints `x + '|' + str(y)`) and
 * `Inner_Missing` (Required input `who`, its body prints `'hello ' + who`), both holding no value.
 * The window edits, the Save and the run are made through the UI.
 *
 * Pass Criteria:
 * 1. Drilled into `Outer_Fn`, both nested Function Blocks show the alert badge naming their empty Required
 *    input: `Required parameter 'x' is missing` and `Required parameter 'who' is missing`.
 * 2. In `Inner_Ok`'s window an {x} input offers `in_a`, `out_b` and `loc_c`, and not the root flow's
 *    `test_var`; `in_a + loc_c` and `out_b` are taken with no "not defined" mark; after Save its badge is gone.
 * 3. `Inner_Missing` keeps its badge until `who` is given a value in its window.
 * 4. The Test then saves, the stored Blocks hold what the windows set, and the run passes printing `AL|B`
 *    and `hello Bo`.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { dismissLoadDialogIfPresent, openTest, rawPersistTest } from '../../helpers/fn-seed'
import {
  alertBadge,
  badgeMessages,
  chainEdges,
  cleanUp,
  configOf,
  fieldCode,
  fieldRow,
  localFunctionBlock,
  logBlock,
  offeredNames,
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

const OUTER = 'fn-outer'
const INNER_OK = 'fn-inner-ok'
const INNER_MISSING = 'fn-inner-missing'
const SCOPE_NAMES = ['in_a', 'out_b', 'loc_c']

function seedNodes(): Array<Record<string, unknown>> {
  const innerOk = localFunctionBlock(
    INNER_OK,
    'Inner_Ok',
    {
      inputs: [
        { name: 'x', type: 'string', required: true, description: '' },
        { name: 'y', type: 'string', required: false, default: null, description: '' },
      ],
      nodes: [logBlock('inner-ok-log', 'Print Inner', "x + '|' + str(y)")],
    },
    { position: { x: 200, y: 160 } },
  )
  const innerMissing = localFunctionBlock(
    INNER_MISSING,
    'Inner_Missing',
    {
      inputs: [{ name: 'who', type: 'string', required: true, description: '' }],
      nodes: [logBlock('inner-missing-log', 'Print Who', "'hello ' + who")],
    },
    { position: { x: 200, y: 320 } },
  )
  return [
    localFunctionBlock(
      OUTER,
      'Outer_Fn',
      {
        inputs: [{ name: 'in_a', type: 'string', required: true, description: '' }],
        outputs: [{ name: 'out_b', type: 'string', default: 'B', description: '' }],
        variables: [{ name: 'loc_c', type: 'string', value: 'L' }],
        nodes: [innerOk, innerMissing],
      },
      { values: { in_a: 'A' } },
    ),
  ]
}

/** The {x} editor of `name` carries no "not defined" mark and keeps its plain border. */
async function expectNoUnknownName(sheet: Locator, name: string): Promise<void> {
  const box = fieldRow(sheet, name).locator(`[data-testid="param-input-${name}"]`)
  await expect(box.locator('.cm-unknown-variable'), `${name}: no name is marked unknown`).toHaveCount(0)
  await expect(box, `${name}: no warning border`).toHaveClass(/\bborder-input\b/)
  await expect(box.locator(`[data-testid="param-input-${name}-not-checked"]`)).toHaveCount(0)
}

/** Switch `name` to {x}, check the names it offers, and give it `expression`. */
async function setScopedExpression(page: Page, sheet: Locator, name: string, expression: string): Promise<void> {
  const toggle = fieldRow(sheet, name).locator('[data-testid="expression-toggle"]')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const offered = await offeredNames(page, fieldCode(sheet, name))
  for (const scoped of SCOPE_NAMES) expect(offered, `${name} offers ${scoped}`).toContain(scoped)
  expect(offered, `${name} does not offer the root flow's variable`).not.toContain('test_var')
  await replaceCode(page, fieldCode(sheet, name), expression)
  await expectNoUnknownName(sheet, name)
}

test.describe('V-FN-SCOPE-NAMES-FUNCTIONAL: names in scope where a Function Block sits', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('a nested Function Block offers the enclosing names, and an empty Required input shows the badge until set', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const name = zzName('scope-names')
    const testId = await rawPersistTest(request, {
      name,
      nodes: seedNodes(),
      edges: chainEdges([OUTER]),
      variables: { test_var: { type: 'string', value: 'T', scope: 'test' } },
    })
    testIds.push(testId)
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)
    await digIn(page, OUTER)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)

    await test.step('both nested Function Blocks name their empty Required input on the badge', async () => {
      expect(await badgeMessages(page, INNER_OK)).toContain("Required parameter 'x' is missing")
      expect(await badgeMessages(page, INNER_MISSING)).toEqual(["Required parameter 'who' is missing"])
    })

    await test.step("Inner_Ok's {x} inputs offer the enclosing names and take them with no unknown mark", async () => {
      const sheet = await openBlockWindow(page, INNER_OK)
      await setScopedExpression(page, sheet, 'x', 'in_a + loc_c')
      await setScopedExpression(page, sheet, 'y', 'out_b')
      await saveBlockWindow(sheet)
      await expect(alertBadge(page, INNER_OK), 'the badge is gone').toHaveCount(0)
    })

    await test.step('Inner_Missing keeps its badge until its Required input is set', async () => {
      await expect(alertBadge(page, INNER_MISSING)).toBeVisible()
      const sheet = await openBlockWindow(page, INNER_MISSING)
      await fieldRow(sheet, 'who').getByRole('textbox').fill('Bo')
      await saveBlockWindow(sheet)
      await expect(alertBadge(page, INNER_MISSING), 'the badge is gone').toHaveCount(0)
    })

    await test.step('the Test saves what the windows set', async () => {
      await popToBreadcrumbSegment(page, name)
      await saveTest(page)
      const ok = await storedBlock(request, testId, OUTER, INNER_OK)
      expect(configOf(ok).values).toEqual({ x: 'in_a + loc_c', y: 'out_b' })
      expect([...((ok.expressionFields ?? []) as string[])].sort()).toEqual(['x', 'y'])
      const missing = await storedBlock(request, testId, OUTER, INNER_MISSING)
      expect(configOf(missing).values).toEqual({ who: 'Bo' })
    })

    await test.step('the run gives each nested Function Block the enclosing values', async () => {
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, formatEntries(entries)).toBe('passed')
      expectConsoleLine(entries, 'INFO', 'AL|B')
      expectConsoleLine(entries, 'INFO', 'hello Bo')
    })
  })
})
