/**
 * V-FN-INPUT-COMPUTED-BINDING: a Function input bound to an expression or a template variable.
 * Wireframe: none (functional)
 * Design Decisions: VMGR-19
 * REQ: REQ-3.2.1.5, REQ-3.1.3.13
 *
 * Pass Criteria:
 * 1. A full Run gives each Function input the evaluated value of the computed variable it is
 *    bound to, though no block read that variable before the Function: the Log in the body
 *    prints the value, never the variable's name (expression and template).
 * 2. After a block run on the Test canvas evaluated both variables, a pencil edit of the
 *    variable they read reaches the input at the start of a Run Current inside each
 *    Function, which has not run in the session: the Log prints the new value (expression
 *    and template).
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { deleteTest, importValidated, readFixture } from '../../helpers/element-types'
import { openTest } from '../../helpers/fn-seed'
import { popToBreadcrumbSegment, selectEnvironment } from '../../helpers/workbench'
import {
  canvasBlock,
  editWithPencil,
  expectLines,
  openFunction,
  runCurrentToEnd,
  runTestToEnd,
} from '../fn-local-vars-runtime/fn-adhoc-drive'

const READS_EXPRESSION = '0ceec847-3bba-466d-ae5b-f2f088318141'
const PRINT_EXPRESSION_INPUT = 'baac30f8-f2eb-4e02-872d-afc1114424d2'
const READS_TEMPLATE = '8ee0aae3-2c1a-41d5-90fb-0cf42fea0d2e'
const PRINT_TEMPLATE_INPUT = 'b50d4919-c835-42b6-bed2-092b14da893f'
const OUTER_READ = '0850580c-f275-4e61-b1e9-392b1b9704e9'
const TEST_NAME = /V-FN-INPUT-COMPUTED-BINDING/
const SEED_PORT = 8080
const EDITED_PORT = 9090

const expressionValue = (port: number): string => `http://api.example:${port}/expression`
const templateValue = (port: number): string => `http://api.example:${port}/template`
const expressionLine = (port: number): string => `fn-expr:${expressionValue(port)}`
const templateLine = (port: number): string => `fn-tmpl:${templateValue(port)}`
const outerLine = (port: number): string => `outer-read:${expressionValue(port)}|${templateValue(port)}`

test.describe('V-FN-INPUT-COMPUTED-BINDING: a Function input bound to a computed variable', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  /** Import the Test and open it with the environment picked. */
  async function openReadyToRun(page: Page, request: APIRequestContext): Promise<void> {
    testId = await importValidated(request, readFixture(__dirname, 'computed-binding-fixture.json'))
    await openTest(page, testId)
    await selectEnvironment(page)
  }

  test('a full Run gives the input the evaluated value of a variable no block read yet', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await openReadyToRun(page, request)

    await runTestToEnd(page)

    await expectLines(
      page,
      'fn-',
      [expressionLine(SEED_PORT), templateLine(SEED_PORT)],
      'each Function prints the evaluated value of its input, not the name of the variable',
    )
    await expectLines(
      page,
      'outer-read:',
      [outerLine(SEED_PORT)],
      'the block after the Functions reads the same two results',
    )
  })

  test('an edit of the variable a computed variable reads reaches the input on Run Current in the Function', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await openReadyToRun(page, request)

    await test.step('a block run on the Test canvas evaluates both computed variables', async () => {
      await runCurrentToEnd(page, OUTER_READ)
      await expectLines(page, 'outer-read:', [outerLine(SEED_PORT)], 'Outer Read prints both results')
    })

    await test.step('the variable both read is changed with the pencil', async () => {
      await editWithPencil(page, 'port', String(EDITED_PORT))
    })

    await test.step('Run Current in the Function bound to the expression prints the new value', async () => {
      await openFunction(page, READS_EXPRESSION, PRINT_EXPRESSION_INPUT)
      await runCurrentToEnd(page, PRINT_EXPRESSION_INPUT)
      await expectLines(
        page,
        'fn-expr:',
        [expressionLine(EDITED_PORT)],
        'the input bound to the expression holds the value for the edited port',
      )
    })

    await test.step('Run Current in the Function bound to the template prints the new value', async () => {
      await popToBreadcrumbSegment(page, TEST_NAME)
      await expect(canvasBlock(page, READS_TEMPLATE)).toBeVisible({ timeout: 15_000 })
      await openFunction(page, READS_TEMPLATE, PRINT_TEMPLATE_INPUT)
      await runCurrentToEnd(page, PRINT_TEMPLATE_INPUT)
      await expectLines(
        page,
        'fn-tmpl:',
        [templateLine(EDITED_PORT)],
        'the input bound to the template holds the value for the edited port',
      )
    })
  })
})
