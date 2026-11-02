/**
 * V-FN-LOCAL-EXPRESSION-VARS (functional): a Function's own Expression and Template variables and its
 * Expression and Template outputs evaluate when they are read or when the Function returns
 * Wireframe: none (functional)
 * Design Decisions: VMGR-99
 * REQ: REQ-3.1.2.1, REQ-3.1.2.8, REQ-3.1.3.15
 *
 * Seeds (API): a blank `zz-` Test per UI test (`createValidTest`). Everything else in those tests is
 * built through the UI: the Function dragged from the palette under Start, its inputs, outputs and
 * local variables made with the in-Function Add menu, a Log dropped under the body's Start, the outputs
 * bound to new variables typed into the call window. The library test seeds the published Function
 * with `publishLibraryFunction` and a `zz-` Test holding its Shared block (outputs bound) with
 * `createValidTest`.
 *
 * Pass Criteria:
 * 1. The local `fn_total` (Integer, Expression `2 + 3`) reads 5 and `fn_greet` (String, Template
 *    `hi {{ fn_total }}`) reads `hi 5` in the body; the Log prints `5|hi 5` and the run passes.
 * 2. A local Expression variable of every type (string, integer, float, boolean, array, map, table)
 *    and a local Template variable hold the evaluated value when the body reads them, never the source.
 * 3. An Expression output of every type and a Template output reach the variables the call binds them
 *    to evaluated, each typed as its output.
 * 4. An Expression output that fails at return fails the call and names the output:
 *    `Output 'o_bad': Expression evaluation failed for '1 / 0': division by zero`.
 * 5. A Template output with a null piece fails the call and names the output:
 *    `'{{ note }}' in 'o_label' is null`.
 * 6. A published library Function's Expression local and Expression output evaluate the same way.
 * 7. A table Expression variable holds a table (its column names read in the body) and a float
 *    Expression variable an exact float, in the root flow and inside a Function.
 * 8. A table Expression output that is not rows fails the call with the type check's message:
 *    `Output 'o_rows': Parameter 'o_rows' expects table, got list`.
 * 9. A float variable holding a whole number is a float: typed in the window, seeded as a whole
 *    number (API seed `f_seeded` = 5) or computed (`2 + 3`), the session reads it typed float, `5`.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import {
  createValidTest,
  logNode,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
} from '../../helpers/fn-seed'
import {
  breadcrumbFunctionSegments,
  digIn,
  dropBelowStart,
  openFunctionBlockSheet,
  popToBreadcrumbSegment,
  runToEnd,
  saveTest,
  selectEnvironment,
  setBlockExpression,
} from '../../helpers/workbench'
import { bindOutput } from '../../helpers/config-sheet'
import {
  createDeclaration,
  createFunctionParam,
  fillDeclaration,
  openCreateModal,
  submitCreate,
  variableRow,
  type StoredDeclaration,
} from '../../helpers/variable-create'
import { getActiveSessionId, getSessionVariables, sessionTable, type SessionVariables } from '../../helpers/fixture-import'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries, type LogEntry } from '../../helpers/log-reader'
import { setStringParam } from '../../helpers/param-config'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { openConfig, saveConfig } from '../canvas-lanes/lanes-helpers'
import { randomUUID } from 'node:crypto'

const NEW_FUNCTION = '[data-testid="palette-new-block-button"]'

async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

// Per VMGR-99: one source per type; each prints, through the body Log, the value shown beside it.
const LOCAL_EXPRESSIONS: ReadonlyArray<{ type: string; source: string; printed: string }> = [
  { type: 'string', source: "'ab' + 'c'", printed: 'abc' },
  { type: 'integer', source: '2 + 3', printed: '5' },
  { type: 'float', source: '1.5 * 3', printed: '4.5' },
  { type: 'boolean', source: '2 > 1', printed: 'True' },
  { type: 'array', source: '[1, 2] + [3]', printed: '[1, 2, 3]' },
  { type: 'map', source: "{'k': 2 * 3}", printed: "{'k': 6}" },
  { type: 'table', source: "[{'k': 1}, {'k': 2}]", printed: '2' },
]

// Per REQ-3.1.2.8: one source per type over the input `n` = 3, and the value the bound variable holds
// as the session read gives it (an exact float as its decimal text).
const OUTPUT_EXPRESSIONS: ReadonlyArray<{ type: string; source: string; value: unknown }> = [
  { type: 'string', source: "'n' + str(n)", value: 'n3' },
  { type: 'integer', source: 'n + 2', value: 5 },
  { type: 'float', source: 'n * 1.5', value: '4.5' },
  { type: 'boolean', source: 'n > 2', value: true },
  { type: 'array', source: '[n, n * 2]', value: [3, 6] },
  { type: 'map', source: "{'k': n * 2}", value: { k: 6 } },
  { type: 'table', source: "[{'k': n}, {'k': n * 2}]", value: [[3], [6]] },
]

const M7 = "Output 'o_bad': Expression evaluation failed for '1 / 0': division by zero"
const M8 = "'{{ note }}' in 'o_label' is null"

interface BuiltFunction {
  fnId: string
  name: string
}

/** Drop a Local Function under Start, drill in, make `decls`, drop one Log printing `message`, come back. */
async function buildFunction(
  page: Page,
  testName: string,
  decls: ReadonlyArray<{ mode: 'input' | 'output' | 'variable'; decl: StoredDeclaration }>,
  log: { kind: 'literal' | 'expression'; message: string },
): Promise<BuiltFunction> {
  const fnId = await dropBelowStart(page, page.locator(NEW_FUNCTION))
  await digIn(page, fnId)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  const name = (await page.locator('[data-testid="breadcrumb-path"] [aria-current="page"]').innerText()).trim()
  for (const { mode, decl } of decls) await createDeclaration(page, mode, decl)
  const logId = await dropBelowStart(page, 'log')
  if (log.kind === 'expression') {
    await setBlockExpression(page, logId, 'message', log.message)
  } else {
    const sheet = await openConfig(page, logId)
    await setStringParam(sheet, page, 'message', log.message)
    await saveConfig(sheet)
  }
  await popToBreadcrumbSegment(page, testName)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
  return { fnId, name }
}

async function storedVariables(request: APIRequestContext, testId: string): Promise<Record<string, { type?: string }>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  return ((await resp.json()).data?.variables ?? {}) as Record<string, { type?: string }>
}

async function sessionVariables(page: Page): Promise<SessionVariables> {
  return getSessionVariables(page, await getActiveSessionId(page))
}

function failedRun(verdict: string | null, entries: readonly LogEntry[]): void {
  expect(verdict, `the run fails.\n${formatEntries(entries)}`).toBe('failed')
}

test.describe('V-FN-LOCAL-EXPRESSION-VARS (functional): Function-local Expression and Template variables', () => {
  let testId = ''
  let functionId = ''

  test.afterEach(async ({ request }) => {
    await deleteTest(request, testId)
    if (functionId) await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`).catch(() => undefined)
    testId = ''
    functionId = ''
  })

  test('a Function-local Expression variable of every type evaluates in the body', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-local-expr-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    const fnId = await dropBelowStart(page, page.locator('[data-testid="palette-new-block-button"]'))
    await digIn(page, fnId)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)

    await createFunctionParam(page, 'variable', 'fn_total', {
      type: 'integer',
      kind: 'Expression',
      value: '2 + 3',
    })
    await createFunctionParam(page, 'variable', 'fn_greet', {
      kind: 'Template',
      value: 'hi {{ fn_total }}',
    })
    const logId = await dropBelowStart(page, 'log')
    await setBlockExpression(page, logId, 'message', "f'{fn_total}|{fn_greet}'")

    await popToBreadcrumbSegment(page, testName)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    expectConsoleLine(entries, 'INFO', '5|hi 5')
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
  })

  test('every type of Function-local Expression variable and a Template variable hold their value in the body', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-local-kinds-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    const pieces = LOCAL_EXPRESSIONS.map(({ type }) => (type === 'table' ? `{len(e_${type})}` : `{e_${type}}`))
    await buildFunction(
      page,
      testName,
      [
        ...LOCAL_EXPRESSIONS.map(({ type, source }) => ({
          mode: 'variable' as const,
          decl: { name: `e_${type}`, type, value: source, isExpression: true },
        })),
        { mode: 'variable', decl: { name: 't_string', type: 'string', value: 't-{{ e_integer }}', isTemplate: true } },
      ],
      { kind: 'expression', message: `f'${[...pieces, '{t_string}'].join('|')}'` },
    )
    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    // Per VMGR-99: each local holds what its source gives, read in the body.
    expectConsoleLine(entries, 'INFO', [...LOCAL_EXPRESSIONS.map(({ printed }) => printed), 't-5'].join('|'))
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
  })

  test('every type of Expression output and a Template output reach the caller evaluated', async ({ page, request }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-output-kinds-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    const fn = await buildFunction(
      page,
      testName,
      [
        { mode: 'input', decl: { name: 'n', type: 'integer', default: 3 } },
        ...OUTPUT_EXPRESSIONS.map(({ type, source }) => ({
          mode: 'output' as const,
          decl: { name: `o_${type}`, type, default: source, isExpression: true },
        })),
        { mode: 'output', decl: { name: 'o_template', type: 'string', default: 'id-{{ n }}', isTemplate: true } },
      ],
      { kind: 'literal', message: 'outputs body' },
    )

    await test.step('the call binds every output to a new variable', async () => {
      const sheet = await openFunctionBlockSheet(page, fn.fnId)
      for (const { type } of OUTPUT_EXPRESSIONS) await bindOutput(sheet, `o_${type}`, `r_${type}`)
      await bindOutput(sheet, 'o_template', 'r_template')
      await saveConfig(sheet)
    })
    await saveTest(page)
    const declared = await storedVariables(request, testId)
    for (const { type } of OUTPUT_EXPRESSIONS) {
      expect.soft(declared[`r_${type}`]?.type, `the new variable r_${type} is declared ${type}`).toBe(type)
    }
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')

    const variables = await sessionVariables(page)
    // Per REQ-3.1.2.8: an Expression or Template output is evaluated when the Function returns.
    for (const { type, value } of OUTPUT_EXPRESSIONS) {
      const name = `r_${type}`
      expect.soft(variables[name]?.type, `${name} is typed ${type}`).toBe(type)
      if (type === 'table') {
        const table = sessionTable(variables, name)
        expect.soft(table.columns.map((column) => column.name), `${name} columns`).toEqual(['k'])
        expect.soft(table.rows, `${name} rows`).toEqual(value)
      } else {
        expect.soft(variables[name]?.value, `${name} holds the evaluated output`).toEqual(value)
      }
    }
    expect.soft(variables.r_template?.value, 'r_template holds the rendered output').toBe('id-3')
  })

  test('an Expression output that fails at return fails the call and names the output', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-output-fails-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    const fn = await buildFunction(
      page,
      testName,
      [{ mode: 'output', decl: { name: 'o_bad', type: 'integer', default: '1 / 0', isExpression: true } }],
      { kind: 'literal', message: 'o_bad body' },
    )
    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    expectConsoleLine(entries, 'INFO', 'o_bad body')
    // REQ-3.1.2.8: the body ran; the output failed when the Function returned.
    expectConsoleLine(entries, 'ERROR', `Function '${fn.name}' completed with status failed: ${M7}`)
    await expectNodeStatus(page, fn.fnId, 'failed')
    failedRun(verdict, entries)
  })

  test('a Template output with a null piece fails the call and names the output', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-output-null-piece-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    const fn = await buildFunction(
      page,
      testName,
      [
        { mode: 'input', decl: { name: 'note', type: 'string', default: null } },
        { mode: 'output', decl: { name: 'o_label', type: 'string', default: 'id-{{ note }}', isTemplate: true } },
      ],
      { kind: 'literal', message: 'o_label body' },
    )
    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    expectConsoleLine(entries, 'INFO', 'o_label body')
    // REQ-3.1.2.8: the null piece names the output it sits in.
    expectConsoleLine(entries, 'ERROR', `Function '${fn.name}' completed with status failed: ${M8}`)
    await expectNodeStatus(page, fn.fnId, 'failed')
    failedRun(verdict, entries)
  })

  test('a table or float Expression variable of the root flow holds its declared type', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testName = `zz-root-expr-types-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    for (const decl of [
      { name: 't_rows', type: 'table', value: "[{'k': 1}, {'k': 2}]", isExpression: true },
      { name: 'f_ratio', type: 'float', value: '1.5 * 3', isExpression: true },
    ]) {
      const modal = await openCreateModal(page)
      await fillDeclaration(page, modal, 'variable', decl)
      await submitCreate(page, modal)
      await expect(modal).toBeHidden()
      await expect(variableRow(page, decl.name)).toBeVisible()
    }
    const logId = await dropBelowStart(page, 'log')
    await setBlockExpression(page, logId, 'message', "f'{t_rows.col_names()}|{f_ratio}'")
    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    // Per REQ-3.1.3.13: a computed variable is realized as its declared type, as a literal is.
    expectConsoleLine(entries, 'INFO', "['k']|4.5")
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
    const variables = await sessionVariables(page)
    expect.soft(sessionTable(variables, 't_rows').rows, 't_rows rows').toEqual([[1], [2]])
    expect.soft(variables.f_ratio?.type, 'f_ratio is typed float').toBe('float')
    expect.soft(variables.f_ratio?.value, 'f_ratio holds the exact float').toBe('4.5')
  })

  test('a table Expression variable of a Function holds a table in the body', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-local-table-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    await buildFunction(
      page,
      testName,
      [{ mode: 'variable', decl: { name: 'e_rows', type: 'table', value: "[{'k': 1}, {'k': 2}]", isExpression: true } }],
      { kind: 'expression', message: "f'{e_rows.col_names()}|{e_rows.row_count()}'" },
    )
    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    expectConsoleLine(entries, 'INFO', "['k']|2")
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
  })

  test('a table Expression output that is not rows fails the call with the type message', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-output-not-rows-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)

    const fn = await buildFunction(
      page,
      testName,
      [{ mode: 'output', decl: { name: 'o_rows', type: 'table', default: '[1, 2]', isExpression: true } }],
      { kind: 'literal', message: 'o_rows body' },
    )
    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    expectConsoleLine(entries, 'INFO', 'o_rows body')
    // Per REQ-3.1.3.13: a list that is not rows is not a table; the existing type message names it.
    expectConsoleLine(
      entries,
      'ERROR',
      `Function '${fn.name}' completed with status failed: Output 'o_rows': Parameter 'o_rows' expects table, got list`,
    )
    await expectNodeStatus(page, fn.fnId, 'failed')
    failedRun(verdict, entries)
  })

  test('a float variable holding a whole number is a float, typed, seeded or computed', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testName = `zz-whole-floats-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, {
      name: testName,
      nodes: [],
      variables: { f_seeded: { type: 'float', value: 5, scope: 'test' } },
    })
    await openTest(page, testId)

    for (const decl of [
      { name: 'f_typed', type: 'float', value: 5 },
      { name: 'f_sum', type: 'float', value: '2 + 3', isExpression: true },
    ]) {
      const modal = await openCreateModal(page)
      await fillDeclaration(page, modal, 'variable', decl)
      await submitCreate(page, modal)
      await expect(modal).toBeHidden()
      await expect(variableRow(page, decl.name)).toBeVisible()
    }
    const logId = await dropBelowStart(page, 'log')
    await setBlockExpression(page, logId, 'message', "f'{f_typed}|{f_seeded}|{f_sum}'")
    await saveTest(page)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    expectConsoleLine(entries, 'INFO', '5|5|5')
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
    const variables = await sessionVariables(page)
    // Per REQ-3.1.3.14: a float is shown as the exact text of its value, here `5`.
    for (const name of ['f_typed', 'f_seeded', 'f_sum']) {
      expect.soft(variables[name]?.type, `${name} is typed float`).toBe('float')
      expect.soft(variables[name]?.value, `${name} holds 5 as float text`).toBe('5')
    }
  })

  test("a library Function's Expression local and Expression output evaluate", async ({ page, request }) => {
    await ensureEnvironment(request)
    const published = await publishLibraryFunction(request, {
      name: `zz-fn-kinds-lib-${randomUUID().slice(0, 8)}`,
      inputs: [{ name: 'n', type: 'integer', default: 3, required: false }],
      outputs: [{ name: 'o_integer', type: 'integer', default: 'n * 2', isExpression: true }],
      variables: [{ name: 'e_integer', type: 'integer', value: 'n + 2', isExpression: true }],
      workflow: { nodes: [logNode('lib-log', 'Log', "f'lib {e_integer}'")], edges: [startEdge('lib-log')] },
    })
    functionId = published.functionId
    const call = sharedNode('fn-lib', {
      functionId: published.functionId,
      functionVersion: published.version,
      label: published.name,
      originalLibraryName: published.name,
    }) as { data: { config: { outputBindings: Record<string, string> } } }
    call.data.config.outputBindings = { o_integer: 'r_integer' }
    testId = await createValidTest(request, {
      name: `zz-fn-kinds-lib-call-${randomUUID().slice(0, 8)}`,
      nodes: [call as unknown as Record<string, unknown>],
      edges: [startEdge('fn-lib')],
      variables: { r_integer: { type: 'integer', value: 0, scope: 'test' } },
    })
    await openTest(page, testId)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)

    // Per VMGR-99: the published body evaluates its Expression local and its Expression output.
    expectConsoleLine(entries, 'INFO', 'lib 5')
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
    const variables = await sessionVariables(page)
    expect(variables.r_integer?.value, 'r_integer holds the evaluated output').toBe(6)
  })
})
