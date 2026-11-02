/**
 * V-FN-VAL-EXPRESSION-OUTPUT-01: the save check reads the names in a Function's own expressions
 * Wireframe: none (functional)
 * Design Decisions: VMGR-99
 * REQ: REQ-3.1.2.4, REQ-3.1.2.8
 *
 * Seeds (API): stored shapes through the admin bulk route (`rawPersistTest`), which stores a Test
 * without running the save check: a `zz-` Test holding one Local Function whose local variable or
 * output carries the Expression under test. The window tests seed a `zz-` Test holding one Local
 * Function (`createValidTest`) and type the declarations into the in-Function create window.
 * The create window accepts an unknown name, so that case is built in the window and refused by
 * the toolbar Save; it refuses a self reference and a cycle when the field loses focus, so their save
 * check runs on the stored shape.
 *
 * Pass Criteria:
 * 1. A Function-local Expression naming an unknown name: validate reports
 *    UNRESOLVED_VARIABLE_REFERENCE `Variable 'nope' is not defined in this Function's scope (inputs,
 *    outputs, and local variables)` and the normal write path refuses the Test (422).
 * 2. An unknown name typed into a Function-local and an Output Expression in the window is refused when
 *    the Test is saved: the Cannot Save Test dialog names both, and nothing is stored; the stored Output
 *    shape gets the same finding and 422.
 * 3. A self reference in a Function-local or an Output Expression is refused by the window (cycle error,
 *    Create disabled) and by the save check: EXPRESSION_CYCLE `Circular reference detected for
 *    variable '<name>': <name> -> <name>` and 422.
 * 4. A cycle between two Function-local or two Output Expressions is refused by the window on the second
 *    one and by the save check, naming the first of the cycle in declaration order, and 422.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  postTestStatus,
  rawPersistTest,
  startEdge,
  validateTest,
  VALIDATION,
  type RawTestSpec,
} from '../../helpers/fn-seed'
import {
  cancelCreate,
  createDeclaration,
  fillDeclaration,
  openFunctionCreateModal,
  type StoredDeclaration,
} from '../../helpers/variable-create'
import { breadcrumbFunctionSegments, digIn, popToBreadcrumbSegment, saveBtn } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_ID = 'fn-expr-scope'

/** UNRESOLVED_VARIABLE_REFERENCE for a name outside the Function's scope. */
function unknownName(name: string): string {
  return `Variable '${name}' is not defined in this Function's scope (inputs, outputs, and local variables)`
}

/** EXPRESSION_CYCLE for a self reference or a cycle, named by its path from the first name. */
function cycleAt(...path: string[]): string {
  return `Circular reference detected for variable '${path[0]}': ${path.join(' -> ')}`
}

// Per REQ-3.1.2.4: the scope message, also raised for a local's expression.
const UNKNOWN_NOPE = unknownName('nope')

function scopeSpec(name: string, decls: { variables?: StoredDeclaration[]; outputs?: StoredDeclaration[] }): RawTestSpec {
  return {
    name,
    nodes: [
      localFunctionNode(FN_ID, 'Expr_Scope', {
        nodes: [logNode('fn-log', 'Read Scope', "'scope'", { x: 200, y: 180 })],
        edges: [startEdge('fn-log')],
        variables: decls.variables ?? [],
        outputs: decls.outputs ?? [],
      }),
    ],
    edges: [startEdge(FN_ID)],
  }
}

function unknownNameSpec(name: string): RawTestSpec {
  return {
    name,
    nodes: [
      localFunctionNode(FN_ID, 'Expr_Scope', {
        nodes: [logNode('fn-log', 'Read Bad', "f'{bad}'", { x: 200, y: 180 })],
        edges: [startEdge('fn-log')],
        variables: [{ name: 'bad', type: 'integer', value: 'nope + 1', isExpression: true }],
      }),
    ],
    edges: [startEdge(FN_ID)],
  }
}

function expression(name: string, source: string): StoredDeclaration {
  return { name, type: 'integer', value: source, isExpression: true }
}

function expressionOutput(name: string, source: string): StoredDeclaration {
  return { name, type: 'integer', default: source, isExpression: true }
}

function uniqueName(label: string): string {
  return `zz-fn-val-expr-${label}-${randomUUID().slice(0, 8)}`
}

async function deleteTests(request: APIRequestContext, testIds: string[]): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  for (const testId of testIds) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

/** Open a seeded Test holding the Local Function and drill into it. */
async function openFunction(page: Page, request: APIRequestContext, testName: string): Promise<string> {
  const testId = await createValidTest(request, scopeSpec(testName, {}))
  await openTest(page, testId)
  await digIn(page, FN_ID)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  return testId
}

/** Type `decl` into a create window, leave the field, and check the window refuses the cycle, named from `first`. */
async function expectWindowRefusesCycle(
  page: Page,
  mode: 'output' | 'variable',
  decl: StoredDeclaration,
  first: string,
): Promise<void> {
  const modal = await openFunctionCreateModal(page, mode)
  await fillDeclaration(page, modal, mode, decl)
  await expect(modal.getByTestId('create-cycle-error'), `the window names the cycle through ${decl.name}`).toContainText(
    `Circular reference detected for variable '${first}'`,
  )
  await expect(modal.getByTestId('create-submit-button'), 'Create is disabled').toBeDisabled()
  await cancelCreate(page, modal)
}

test.describe('V-FN-VAL-EXPRESSION-OUTPUT-01: names in Function expressions are checked on save', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await deleteTests(request, testIds.splice(0))
  })

  /** Store `spec` without the save check, then expect validate to report `code` with `message` and Save to refuse it. */
  async function expectSaveCheckRefuses(
    request: APIRequestContext,
    spec: RawTestSpec,
    code: string,
    message: string,
  ): Promise<void> {
    const testId = await rawPersistTest(request, spec)
    testIds.push(testId)
    const result = await validateTest(request, testId)
    const found = result.errors.filter((issue) => issue.code === code).map((issue) => String(issue.message))
    expect(found, `validate must report ${code}; errors: ${JSON.stringify(result.errors)}`).toContain(message)
    const saveStatus = await postTestStatus(request, { ...spec, name: `${spec.name}-save` })
    expect(saveStatus, 'the normal write path refuses the Test').toBe(422)
  }

  test('an unknown name in a Function-local expression is refused on save', async ({ request }) => {
    const name = `zz-fn-val-expr-${randomUUID().slice(0, 8)}`
    const testId = await rawPersistTest(request, unknownNameSpec(name))
    testIds.push(testId)

    const result = await validateTest(request, testId)
    const unresolved = result.errors
      .filter((issue) => issue.code === 'UNRESOLVED_VARIABLE_REFERENCE')
      .map((issue) => String(issue.message))
    expect(
      unresolved,
      `validate must name 'nope'; errors: ${JSON.stringify(result.errors)}`,
    ).toContain(UNKNOWN_NOPE)

    const saveStatus = await postTestStatus(request, unknownNameSpec(`${name}-save`))
    expect(saveStatus, 'the normal write path refuses the Test').toBe(422)
  })

  test('an unknown name typed into a Function-local and an Output expression is refused when the Test is saved', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testName = uniqueName('unknown')
    const testId = await openFunction(page, request, testName)
    testIds.push(testId)

    await test.step('the window takes both declarations', async () => {
      await createDeclaration(page, 'variable', expression('bad', 'nope + 1'))
      await createDeclaration(page, 'output', expressionOutput('o_bad', 'gone * 2'))
    })

    await test.step('Save is refused and names both', async () => {
      await popToBreadcrumbSegment(page, testName)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
      await expect(saveBtn(page)).toBeEnabled({ timeout: 10_000 })
      await saveBtn(page).click()
      const dialog = page.locator(VALIDATION.dialog)
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog).toContainText('Cannot Save Test')
      // UNRESOLVED_VARIABLE_REFERENCE for the local and for the output.
      await expect(dialog).toContainText(unknownName('nope'))
      await expect(dialog).toContainText(unknownName('gone'))
    })

    const stored = await request.get(`${BACKEND_URL}/tests/${testId}`)
    const definition = (await stored.json()).data?.workflow?.nodes?.find((node: { id: string }) => node.id === FN_ID)?.data
      ?.localDefinition
    expect(
      [...(definition?.variables ?? []), ...(definition?.outputs ?? [])].map((decl: { name: string }) => decl.name),
      'the refused save stored nothing',
    ).toEqual([])

    await expectSaveCheckRefuses(
      request,
      scopeSpec(uniqueName('unknown-output'), { outputs: [expressionOutput('o_bad', 'gone * 2')] }),
      'UNRESOLVED_VARIABLE_REFERENCE',
      unknownName('gone'),
    )
  })

  test('a self reference in a Function-local or an Output expression is refused by the window and by the save check', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testIds.push(await openFunction(page, request, uniqueName('self-window')))

    await expectWindowRefusesCycle(page, 'variable', expression('selfy', 'selfy + 1'), 'selfy')
    await expectWindowRefusesCycle(page, 'output', expressionOutput('o_self', 'o_self + 1'), 'o_self')

    await expectSaveCheckRefuses(
      request,
      scopeSpec(uniqueName('self-local'), { variables: [expression('selfy', 'selfy + 1')] }),
      'EXPRESSION_CYCLE',
      cycleAt('selfy', 'selfy'),
    )
    await expectSaveCheckRefuses(
      request,
      scopeSpec(uniqueName('self-output'), { outputs: [expressionOutput('o_self', 'o_self + 1')] }),
      'EXPRESSION_CYCLE',
      cycleAt('o_self', 'o_self'),
    )
  })

  test('a cycle between two Function-local or two Output expressions is refused by the window and by the save check', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testIds.push(await openFunction(page, request, uniqueName('cycle-window')))

    await createDeclaration(page, 'variable', expression('cy_a', 'cy_b + 1'))
    await expectWindowRefusesCycle(page, 'variable', expression('cy_b', 'cy_a + 1'), 'cy_a')
    await createDeclaration(page, 'output', expressionOutput('o_a', 'o_b + 1'))
    await expectWindowRefusesCycle(page, 'output', expressionOutput('o_b', 'o_a + 1'), 'o_a')

    // EXPRESSION_CYCLE names the first of the cycle in declaration order.
    await expectSaveCheckRefuses(
      request,
      scopeSpec(uniqueName('cycle-local'), { variables: [expression('cy_a', 'cy_b + 1'), expression('cy_b', 'cy_a + 1')] }),
      'EXPRESSION_CYCLE',
      cycleAt('cy_a', 'cy_b', 'cy_a'),
    )
    await expectSaveCheckRefuses(
      request,
      scopeSpec(uniqueName('cycle-output'), { outputs: [expressionOutput('o_a', 'o_b + 1'), expressionOutput('o_b', 'o_a + 1')] }),
      'EXPRESSION_CYCLE',
      cycleAt('o_a', 'o_b', 'o_a'),
    )
  })
})
