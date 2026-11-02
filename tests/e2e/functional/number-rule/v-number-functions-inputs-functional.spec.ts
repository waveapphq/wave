/**
 * V-NUMBER-FUNCTIONS-INPUTS-FUNCTIONAL: Function inputs, outputs and locals follow the one number rule
 * Design Decisions: VMGR-112, FNCFG-9
 * REQ: REQ-3.1.3.14, REQ-3.1.2.11
 *
 * Seeds (API, all `zz-11541-s8-*`): a library Function with an integer input `n` in versions 1.0.0 and 1.1.0 and a
 * Test whose Function Block on 1.0.0 holds `n` = 9007199254740993; a Test holding one empty Local Function for the
 * input window. The version switch, the window and the run go through the UI; the refusals are Function and Test
 * saves through the REST API.
 *
 * Pass Criteria:
 * 1. The Function Block window shows `9007199254740993`; after the Block switches to 1.1.0 it still does, the saved
 *    Test holds that exact text, and the run's body logs `n=9007199254740993`.
 * 2. A Float enum input takes `1.50` and `0.0000001` as allowed values with no error, names `1.5` beside `1.50` as
 *    `Allowed value at index 2 (1.5) is already listed`, and the saved Test stores `["1.50", "0.0000001"]`.
 * 3. An Integer enum input names a 20-digit value `Allowed value at index 0 (12345678901234567890) must have at most
 *    19 digits` and Create stays off.
 * 4. POST /functions refuses `NaN`, `sNaN` and `Infinity` among a Float enum's allowed values with `Allowed value
 *    '<v>' of enum input 'ratio' is not a valid float`, and a default of `Infinity` with `Default 'Infinity' of enum
 *    input 'ratio' is not one of its allowed values`.
 * 5. An input default `1e3`, an output default `NaN` and a 20-digit local value are refused at POST /functions and at
 *    the POST /tests that holds them in a Local Function, each with its `INVALID_VARIABLE_VALUE` message.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { numberInput, saveButton } from '../../helpers/config-sheet'
import { BACKEND_URL } from '../../helpers/config'
import { runToken } from '../../helpers/element-types'
import {
  addLibraryVersion,
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
  storedLocalDefinition,
} from '../../helpers/fn-seed'
import { finishRun, startRun } from '../../helpers/k8s-run'
import {
  deleteFunctionQuietly,
  deleteTestQuietly,
  expectFunctionRefused,
  expectTestRefused,
  discardSheet,
  functionBody,
  functionName,
  storedNode,
  type Finding,
} from '../../helpers/number-rule'
import {
  cancelCreate,
  fillCreateWindow,
  openFunctionCreateModal,
  setAllowedValues,
  variableRow,
} from '../../helpers/variable-create'
import { digIn, openFunctionBlockSheet, popToBreadcrumbSegment, saveTest } from '../../helpers/workbench'

const CALL_ID = 'f1c5b7e0-3a2d-4c9e-8b6f-11541008b001'
const CALL_DONE = 'f1c5b7e0-3a2d-4c9e-8b6f-11541008b002'
const BODY_LOG = 'f1c5b7e0-3a2d-4c9e-8b6f-11541008b003'
const LOCAL_ID = 'f1c5b7e0-3a2d-4c9e-8b6f-11541008b004'
const PAST_2_53 = '9007199254740993'

const INPUT_N = [{ name: 'n', type: 'integer', required: true, description: 'An integer past 2^53' }]

/** The Save-time refusals of a declaration that breaks the number rule. */
const DECLARATION_CASES: Array<{ what: string; declarations: Record<string, unknown>; finding: Finding }> = [
  {
    what: 'an input default of 1e3',
    declarations: { inputs: [{ name: 'n', type: 'integer', required: false, default: '1e3' }] },
    finding: ['INVALID_VARIABLE_VALUE', "Default for input 'n' is not a valid integer"],
  },
  {
    what: 'an output default of NaN',
    declarations: { outputs: [{ name: 'total', type: 'float', default: 'NaN' }] },
    finding: ['INVALID_VARIABLE_VALUE', "Default for output 'total' is not a valid float"],
  },
  {
    what: 'a 20-digit local value',
    declarations: { variables: [{ name: 'big', type: 'integer', value: '12345678901234567890' }] },
    finding: ['INVALID_VARIABLE_VALUE', "Value for local variable 'big' allows at most 19 digits, got 20"],
  },
]

/** A Test holding one Local Function with these declarations. */
function testHolding(declarations: Record<string, unknown>): Record<string, unknown> {
  const node = localFunctionNode(LOCAL_ID, 'Holder', {
    nodes: [],
    inputs: (declarations.inputs as Array<Record<string, unknown>>) ?? [],
    outputs: (declarations.outputs as Array<Record<string, unknown>>) ?? [],
    variables: (declarations.variables as Array<Record<string, unknown>>) ?? [],
  }) as { data: Record<string, unknown> }
  node.data.config = { values: {}, outputBindings: {}, profileBindings: [] }
  return {
    name: `zz-11541-s8-holder-${runToken()}`,
    version: '1.0.0',
    description: 'Holds a Local Function',
    workflow: { nodes: [node], edges: [startEdge(LOCAL_ID)] },
    variables: {},
    metadata: {},
  }
}

async function switchVersion(page: Page, sheet: Locator, version: string): Promise<void> {
  const trigger = sheet.locator('[data-testid="version-dropdown-trigger"]')
  await trigger.click()
  const menu = page.locator('[data-testid="version-dropdown-menu"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitemradio', { name: new RegExp(version.replace(/\./g, '\\.')) }).click()
  await expect(trigger).toContainText(`v${version}`)
}

test.describe('V-NUMBER-FUNCTIONS-INPUTS-FUNCTIONAL: Function declarations follow the number rule', () => {
  const cleanups: Array<() => Promise<unknown>> = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined)
  })

  test('a Function Block integer input past 2^53 keeps every digit across a version change and the run', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const token = runToken()
    const body = {
      nodes: [logNode(BODY_LOG, 'Show N', "f'n={n}'")],
      edges: [startEdge(BODY_LOG)],
    }
    const fn = await publishLibraryFunction(request, {
      name: functionName('fn'),
      inputs: INPUT_N,
      workflow: body,
    })
    cleanups.push(() => deleteFunctionQuietly(request, fn.functionId))
    await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '1.1.0', inputs: INPUT_N, workflow: body })

    const call = sharedNode(CALL_ID, {
      functionId: fn.functionId,
      functionVersion: '1.0.0',
      label: 'Call N',
      originalLibraryName: fn.name,
      values: { n: PAST_2_53 },
    })
    const testId = await createValidTest(request, {
      name: `zz-11541-s8-call-${token}`,
      nodes: [call, logNode(CALL_DONE, 'Functions Done', "'number-functions-done'")],
      edges: [startEdge(CALL_ID), { id: 'e-call-done', source: CALL_ID, target: CALL_DONE }],
    })
    cleanups.push(() => deleteTestQuietly(request, testId))
    expect((await storedNode(request, testId, CALL_ID)).data.config.values.n, 'stored as exact text').toBe(PAST_2_53)

    await test.step('the window keeps the value when the Block moves to 1.1.0', async () => {
      await openTest(page, testId)
      const sheet = await openFunctionBlockSheet(page, CALL_ID)
      await expect(numberInput(sheet, 'n')).toHaveValue(PAST_2_53)
      await switchVersion(page, sheet, '1.1.0')
      await expect(numberInput(sheet, 'n'), 'the switch carries the value over unchanged').toHaveValue(PAST_2_53)
      await expect(saveButton(sheet)).toBeEnabled()
      await saveButton(sheet).click()
      await expect(sheet).toBeHidden({ timeout: 10_000 })
      const reopened = await openFunctionBlockSheet(page, CALL_ID)
      await expect(numberInput(reopened, 'n')).toHaveValue(PAST_2_53)
      await reopened.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(reopened).toBeHidden({ timeout: 10_000 })
      await saveTest(page)
      const stored = await storedNode(request, testId, CALL_ID)
      expect(stored.data.functionVersion).toBe('1.1.0')
      expect(stored.data.config.values.n).toBe(PAST_2_53)
    })

    await test.step('the run hands the body every digit', async () => {
      const status = await startRun(page)
      const logs = await finishRun(page, status, 'number-functions-done')
      expect(logs, logs.join('\n')).toContain(`n=${PAST_2_53}`)
    })
  })

  test('the input window holds enum allowed values to the number rule', async ({ page, request }) => {
    test.setTimeout(240_000)
    const testName = `zz-11541-s8-enum-${randomUUID().slice(0, 8)}`
    const testId = await createValidTest(request, {
      name: testName,
      nodes: [localFunctionNode(LOCAL_ID, 'Enum_Fn', { nodes: [] })],
      edges: [startEdge(LOCAL_ID)],
    })
    cleanups.push(() => deleteTestQuietly(request, testId))
    await openTest(page, testId)
    await digIn(page, LOCAL_ID)

    await test.step('a Float enum takes 1.50 and 0.0000001 and names 1.5 beside 1.50 as already listed', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await fillCreateWindow(page, modal, 'ratio', {
        type: 'float',
        createEnum: true,
        enumValues: ['1.50', '0.0000001'],
        value: '1.50',
      })
      const error = modal.locator('[data-testid="create-enum-error"]')
      const submit = modal.locator('[data-testid="create-submit-button"]')
      await expect(error).toHaveCount(0)
      await expect(submit).toBeEnabled()
      await setAllowedValues(modal, '[1.50, 0.0000001, 1.5]')
      await expect(error).toHaveText('Allowed value at index 2 (1.5) is already listed')
      await expect(submit).toBeDisabled()
      await setAllowedValues(modal, '[1.50, 0.0000001]')
      await expect(error).toHaveCount(0)
      await submit.click()
      await expect(modal).toBeHidden()
      await expect(variableRow(page, 'ratio')).toBeVisible()
    })

    await test.step('an Integer enum names a 20-digit allowed value and holds Create', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await fillCreateWindow(page, modal, 'level', { type: 'integer', createEnum: true })
      await setAllowedValues(modal, '[12345678901234567890]')
      await expect(modal.locator('[data-testid="create-enum-error"]')).toHaveText(
        'Allowed value at index 0 (12345678901234567890) must have at most 19 digits',
      )
      await expect(modal.locator('[data-testid="create-submit-button"]')).toBeDisabled()
      await cancelCreate(page, modal)
    })

    await test.step('the saved Test stores the allowed values as typed', async () => {
      await popToBreadcrumbSegment(page, testName)
      const sheet = await openFunctionBlockSheet(page, LOCAL_ID)
      await expect(sheet.locator('[data-testid="param-row-ratio"] button[role="combobox"]')).toHaveText('1.50')
      await discardSheet(page, sheet)
      await saveTest(page)
      const { inputs } = await storedLocalDefinition(request, testId, LOCAL_ID)
      const ratio = inputs.find((input) => input.name === 'ratio')
      expect(ratio, 'the input is stored').toBeTruthy()
      expect(ratio?.enumValues).toEqual(['1.50', '0.0000001'])
      expect(ratio?.default).toBe('1.50')
    })
  })

  test('Function and Test saves refuse declarations that break the number rule', async ({ request }) => {
    test.setTimeout(120_000)

    await test.step('NaN, sNaN and Infinity are never valid floats in an enum', async () => {
      for (const text of ['NaN', 'sNaN', 'Infinity']) {
        await expectFunctionRefused(
          request,
          functionBody(functionName('enum'), {
            inputs: [{ name: 'ratio', type: 'float', required: true, enumValues: ['1.5', text], default: '1.5' }],
          }),
          [['ENUM_VALUE_TYPE', `Allowed value '${text}' of enum input 'ratio' is not a valid float`]],
        )
      }
      await expectFunctionRefused(
        request,
        functionBody(functionName('enum'), {
          inputs: [{ name: 'ratio', type: 'float', required: true, enumValues: ['1.5'], default: 'Infinity' }],
        }),
        [['ENUM_DEFAULT_NOT_ALLOWED', "Default 'Infinity' of enum input 'ratio' is not one of its allowed values"]],
      )
    })

    for (const declaration of DECLARATION_CASES) {
      await test.step(`${declaration.what} is refused at the Function save and at the Test save`, async () => {
        await expectFunctionRefused(
          request,
          functionBody(functionName('decl'), declaration.declarations),
          [declaration.finding],
        )
        await expectTestRefused(request, testHolding(declaration.declarations), [declaration.finding])
      })
    }
  })
})
