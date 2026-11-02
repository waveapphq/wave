/**
 * V-VAR-UNUSED-REFERENCES-FUNCTIONAL: every place a block names a variable counts as a reference
 * Wireframe: none (functional)
 * Design Decisions: VMGR-105, FNCFG-6
 * REQ: REQ-3.1.3.11
 *
 * Setup (API): one blank `zz-` Test per test (no blocks, no variables), deleted after. The
 * variables, the Function inputs, outputs and locals, every reading block and its setting,
 * condition row, Variable Setter row, filter row or call binding, the removals and the rename are
 * all built through the UI (the place table lives in `unused-places.ts`).
 *
 * Pass Criteria:
 * 1. A variable whose only reader is an Assert condition row shows no Unused badge.
 * 2. The same holds for a condition row of If/Else, Switch, While and Wait Until.
 * 3. A variable a Variable Setter row reads and the variable it writes show no Unused badge.
 * 4. A variable bound to a Function call input shows no Unused badge.
 * 5. Inside a Function, a local bound to a nested Function call input shows no Unused badge.
 * 6. Renaming a variable in the Variable Manager rewrites the Assert condition row that checks
 *    it and the Function call input bound to it: the saved Test names the new name in both
 *    places and the old name nowhere.
 * 7. A Function Block input with nothing bound opens as its literal widget; its expression
 *    toggle switches it to the expression editor the binding is typed into.
 * 8. For each of the 16 places a name is read (a block setting expression or template, another
 *    variable's Expression or Template, a condition row variable of the five check blocks, a
 *    compare-to expression, an expression row, a Variable Setter row value and target, a Function
 *    Block input binding, a For Each collection, a CSV and an Excel filter expression row), in
 *    Test scope and inside a Function (an input and a local): a name read only there shows no
 *    Unused badge, the saved Test holds the reader at that place, and the badge is back once the
 *    reader is removed.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import {
  createFunctionParam,
  createSimpleVariable,
  openFunctionCreateModal,
  setCreateName,
  submitCreate,
  createModal,
  variableRow,
} from '../../helpers/variable-create'
import {
  breadcrumbFunctionSegments,
  digIn,
  openBlockSheet,
  popToBreadcrumbSegment,
  saveBlockSheet,
  saveTest,
} from '../../helpers/workbench'
import {
  dropBlock,
  dropLocalFunction,
  expressionOf,
  openBindingEditor,
  pathsNaming,
  readStoredTest,
  renameVariable,
  storedNode,
  uniqueName,
  unusedBadge,
  zoomOut,
  type StoredNode,
} from './references-helpers'
import {
  CHECK_BLOCKS,
  PLACES,
  buildConditionRows,
  declare,
  storedConditionRows,
  type Reader,
} from './unused-places'

const ASSERT = CHECK_BLOCKS[0]

function firstAssertRow(node: StoredNode): Record<string, unknown> {
  const rows = storedConditionRows(ASSERT, node)
  expect(rows, 'the Assert holds one condition row').toHaveLength(1)
  return rows[0]
}

/** Type a variable name into a Function call input's expression editor and close its suggestions. */
async function typeBinding(page: Page, sheet: Locator, input: string, name: string): Promise<void> {
  const editor = await openBindingEditor(sheet, input)
  await editor.click()
  await page.keyboard.insertText(name)
  const suggestions = page.getByRole('listbox', { name: 'Completions' })
  await expect(suggestions.getByRole('option').filter({ hasText: name })).toBeVisible()
  await leaveExpressionEditor(editor)
  await expect(sheet).toBeVisible()
  await expect(editor).toHaveText(name)
}

test.describe('V-VAR-UNUSED-REFERENCES-FUNCTIONAL: references from conditions and call bindings', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('a name read only by an Assert condition row is not Unused', async ({ page, request }) => {
    testId = await createValidTest(request, { name: uniqueName('v-var-unused-refs'), nodes: [] })
    await openTest(page, testId)

    await test.step('a new variable nothing reads shows the Unused badge', async () => {
      await createSimpleVariable(page, 'only_in_check', { value: 'x' })
      await expect(variableRow(page, 'only_in_check').locator('[data-testid^="unused-badge-"]')).toHaveCount(1)
    })

    const assertId = await dropBlock(page, ASSERT.palette, 0.5, 0.5)

    await test.step('an Assert row checks only_in_check equals x', async () => {
      await buildConditionRows(page, assertId, ASSERT, [['only_in_check', 'x']])
      await saveTest(page)
      const row = firstAssertRow(storedNode(await readStoredTest(page, testId), assertId))
      expect(row.variable).toBe('only_in_check')
      expect(row.operator).toBe('equals')
      expect(row.reference_value).toBe('x')
    })

    // Per VMGR-105: a condition row is a reference.
    await expect(variableRow(page, 'only_in_check').locator('[data-testid^="unused-badge-"]')).toHaveCount(0)
  })

  for (const check of CHECK_BLOCKS.slice(1)) {
    test(`a name read only by ${check.article} ${check.label} condition row is not Unused`, async ({ page, request }) => {
      testId = await createValidTest(request, { name: uniqueName('v-var-unused-refs'), nodes: [] })
      await openTest(page, testId)

      await createSimpleVariable(page, 'only_in_check', { value: 'x' })
      await expect(unusedBadge(page, 'only_in_check')).toHaveCount(1)
      const blockId = await dropBlock(page, check.palette, 0.5, 0.5)

      await test.step(`a ${check.label} row checks only_in_check equals x`, async () => {
        await buildConditionRows(page, blockId, check, [['only_in_check', 'x']])
        await saveTest(page)
        const rows = storedConditionRows(check, storedNode(await readStoredTest(page, testId), blockId))
        expect(rows[0]?.variable, `the stored ${check.label} row`).toBe('only_in_check')
      })

      // Per VMGR-105: a condition row of every check block is a reference.
      await expect(unusedBadge(page, 'only_in_check')).toHaveCount(0)
    })
  }

  test('a name read only by a Variable Setter row is not Unused', async ({ page, request }) => {
    testId = await createValidTest(request, { name: uniqueName('v-var-unused-refs'), nodes: [] })
    await openTest(page, testId)

    await createSimpleVariable(page, 'setter_source', { value: 'a' })
    await createSimpleVariable(page, 'setter_target', { value: 'b' })
    await expect(unusedBadge(page, 'setter_source')).toHaveCount(1)
    await expect(unusedBadge(page, 'setter_target')).toHaveCount(1)
    const setterId = await dropBlock(page, { term: 'var setter', testId: 'palette-item-variable-setter' }, 0.5, 0.5)

    await test.step('a Setter row writes setter_target from the expression setter_source + "!"', async () => {
      const sheet = await openBlockSheet(page, setterId)
      const nameInput = sheet.locator('[data-testid="varset-name-input-0"]')
      if ((await nameInput.count()) === 0) await sheet.locator('[data-testid="varset-add-button"]').click()
      await nameInput.fill('setter_target')
      await sheet.locator('[data-testid="varset-add-button"]').focus()
      await sheet.locator('[data-testid="varset-expression-toggle-0"]').click()
      const editor = sheet.locator('[data-testid="param-input-setter_target"] .cm-content')
      await editor.click()
      await page.keyboard.insertText("setter_source + '!'")
      await leaveExpressionEditor(editor)
      await expect(sheet).toBeVisible()
      await expect(editor).toHaveText("setter_source + '!'")
      await saveBlockSheet(sheet)
      await saveTest(page)
      const variables = (storedNode(await readStoredTest(page, testId), setterId).data.config?.values?.variables ??
        {}) as Record<string, unknown>
      expect(variables.setter_target, 'the stored Setter row').toBe("setter_source + '!'")
    })

    // Per VMGR-105: a Variable Setter row's value and its target are references.
    await expect.soft(unusedBadge(page, 'setter_source'), 'the variable the row reads').toHaveCount(0)
    await expect.soft(unusedBadge(page, 'setter_target'), 'the variable the row writes').toHaveCount(0)
  })

  test('a name read only by a Function call input binding is not Unused', async ({ page, request }) => {
    const testName = uniqueName('v-var-unused-refs')
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    await createSimpleVariable(page, 'bound_only', { value: 'ann' })
    await expect(unusedBadge(page, 'bound_only')).toHaveCount(1)
    await zoomOut(page, 2)
    const fnId = await dropLocalFunction(page, 0.4, 0.5)

    await test.step('the Local Function declares the input who', async () => {
      await digIn(page, fnId)
      await openFunctionCreateModal(page, 'input')
      await setCreateName(page, 'who')
      await submitCreate(page)
      await expect(createModal(page)).toBeHidden()
      await expect(page.locator('[data-testid="in-badge-param:input:who"]')).toBeVisible()
      await popToBreadcrumbSegment(page, testName)
      await expect(page.locator(`[data-testid="workflow-node-${fnId}"]`)).toBeVisible({ timeout: 15_000 })
    })

    await test.step('the call binds who to bound_only', async () => {
      const sheet = await openBlockSheet(page, fnId)
      await typeBinding(page, sheet, 'who', 'bound_only')
      await saveBlockSheet(sheet)
      await saveTest(page)
      expect(expressionOf(storedNode(await readStoredTest(page, testId), fnId), 'who')).toBe('bound_only')
    })

    // Per VMGR-105: a Function call input binding is a reference.
    await expect(unusedBadge(page, 'bound_only')).toHaveCount(0)
  })

  test('a name read only by a nested Function call binding is not Unused', async ({ page, request }) => {
    testId = await createValidTest(request, { name: uniqueName('v-var-unused-refs'), nodes: [] })
    await openTest(page, testId)
    await zoomOut(page, 2)
    const outerId = await dropLocalFunction(page, 0.4, 0.5)
    let outerName = ''

    await test.step('the outer Function holds a local nothing reads', async () => {
      await digIn(page, outerId)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
      outerName = (await page.locator('[data-testid="breadcrumb-path"] [aria-current="page"]').innerText()).trim()
      expect(outerName, 'the breadcrumb names the outer Function').not.toBe('')
      await createFunctionParam(page, 'variable', 'outer_only')
      await expect(unusedBadge(page, 'outer_only')).toHaveCount(1)
    })

    const innerId = await dropLocalFunction(page, 0.6, 0.5)

    await test.step('the nested Function declares the input level', async () => {
      await digIn(page, innerId)
      await openFunctionCreateModal(page, 'input')
      await setCreateName(page, 'level')
      await submitCreate(page)
      await expect(createModal(page)).toBeHidden()
      await expect(page.locator('[data-testid="in-badge-param:input:level"]')).toBeVisible()
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(2)
      await popToBreadcrumbSegment(page, outerName)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
      await expect(page.locator(`[data-testid="workflow-node-${innerId}"]`)).toBeVisible({ timeout: 15_000 })
    })

    await test.step('the nested call binds level to outer_only', async () => {
      const sheet = await openBlockSheet(page, innerId)
      await typeBinding(page, sheet, 'level', 'outer_only')
      await saveBlockSheet(sheet)
      await saveTest(page)
      const outer = storedNode(await readStoredTest(page, testId), outerId)
      const inner = outer.data.localDefinition?.workflow?.nodes?.find((n) => n.id === innerId)
      expect(expressionOf(inner, 'level'), 'the stored nested expression field').toBe('outer_only')
    })

    // Per VMGR-105: a nested Function call input binding is a reference.
    await expect(unusedBadge(page, 'outer_only')).toHaveCount(0)
  })

  test('renaming a variable updates condition rows and Function call bindings', async ({ page, request }) => {
    const testName = uniqueName('v-var-unused-refs')
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    await createSimpleVariable(page, 'status', { value: 'ok' })
    await zoomOut(page, 2)
    const fnId = await dropLocalFunction(page, 0.2, 0.55)

    await test.step('the Local Function declares the input who', async () => {
      await digIn(page, fnId)
      await openFunctionCreateModal(page, 'input')
      await setCreateName(page, 'who')
      await submitCreate(page)
      await expect(createModal(page)).toBeHidden()
      await expect(page.locator('[data-testid="in-badge-param:input:who"]')).toBeVisible()
      await popToBreadcrumbSegment(page, testName)
      await expect(page.locator(`[data-testid="workflow-node-${fnId}"]`)).toBeVisible({ timeout: 15_000 })
    })

    await test.step('the call binds who to status', async () => {
      const sheet = await openBlockSheet(page, fnId)
      await typeBinding(page, sheet, 'who', 'status')
      await saveBlockSheet(sheet)
    })

    const assertId = await dropBlock(page, ASSERT.palette, 0.7, 0.55)

    await test.step('an Assert row checks status equals ok', async () => {
      await buildConditionRows(page, assertId, ASSERT, [['status', 'ok']])
    })

    await test.step('the saved Test reads status in the Assert row and the binding', async () => {
      await saveTest(page)
      const stored = await readStoredTest(page, testId)
      expect(firstAssertRow(storedNode(stored, assertId)).variable).toBe('status')
      expect(expressionOf(storedNode(stored, fnId), 'who')).toBe('status')
    })

    await test.step('rename status to state in the Variable Manager', async () => {
      await renameVariable(page, 'status', 'state')
      await saveTest(page)
    })

    const stored = await readStoredTest(page, testId)
    expect(stored.variables).toHaveProperty('state')
    // Per REQ-3.1.3.11: a rename refactors every reference.
    expect.soft(firstAssertRow(storedNode(stored, assertId)).variable, 'Assert condition row').toBe('state')
    expect.soft(expressionOf(storedNode(stored, fnId), 'who'), 'Function call binding').toBe('state')
    expect(
      pathsNaming({ workflow: stored.workflow, variables: stored.variables }, 'status'),
      'the old name survives nowhere',
    ).toEqual([])
  })
})

test.describe('V-VAR-UNUSED-REFERENCES-FUNCTIONAL: every reference place, in Test scope and in a Function', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  for (const place of PLACES) {
    test(`${place.title}: a name read only there is not Unused, and is Unused once the reader goes`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000)
      const testName = uniqueName('v-var-unused-place')
      testId = await createValidTest(request, { name: testName, nodes: [] })
      await openTest(page, testId)
      await zoomOut(page, 2)
      let testReader: Reader | undefined
      let functionReader: Reader | undefined
      let functionId = ''

      await test.step('Test scope: a variable read only there is not Unused', async () => {
        for (const item of place.test.declare) await declare(page, false, item)
        for (const name of place.test.read) await expect(unusedBadge(page, name), `${name} with no reader`).toHaveCount(1)
        testReader = await place.test.build({ page, functionId: null, scopeName: testName })
        // Per VMGR-105: the place is a reference.
        for (const name of place.test.read) {
          await expect.soft(unusedBadge(page, name), `${name} read in Test scope`).toHaveCount(0)
        }
      })

      await test.step('Function scope: an input and a local read only there are not Unused', async () => {
        functionId = await dropLocalFunction(page, 0.8, 0.2)
        await digIn(page, functionId)
        await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
        const scopeName = (await page.locator('[data-testid="breadcrumb-path"] [aria-current="page"]').innerText()).trim()
        for (const item of place.fn.declare) await declare(page, true, item)
        for (const name of place.fn.read) await expect(unusedBadge(page, name), `${name} with no reader`).toHaveCount(1)
        functionReader = await place.fn.build({ page, functionId, scopeName })
        for (const name of place.fn.read) {
          await expect.soft(unusedBadge(page, name), `${name} read in Function scope`).toHaveCount(0)
        }
      })

      await test.step('the saved Test holds both readers at the place', async () => {
        await saveTest(page)
        const stored = await readStoredTest(page, testId)
        testReader!.verify(stored)
        functionReader!.verify(stored)
      })

      await test.step('Function scope: once the reader goes the input and the local are Unused', async () => {
        await functionReader!.remove()
        for (const name of place.fn.read) await expect.soft(unusedBadge(page, name), `${name} unread`).toHaveCount(1)
        await popToBreadcrumbSegment(page, testName)
        await expect(page.locator(`[data-testid="workflow-node-${functionId}"]`)).toBeVisible({ timeout: 15_000 })
      })

      await test.step('Test scope: once the reader goes the variable is Unused', async () => {
        await testReader!.remove()
        for (const name of place.test.read) await expect.soft(unusedBadge(page, name), `${name} unread`).toHaveCount(1)
      })
    })
  }
})
