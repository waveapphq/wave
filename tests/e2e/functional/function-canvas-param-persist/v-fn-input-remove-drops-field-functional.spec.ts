/**
 * V-FN-INPUT-REMOVE-DROPS-FIELD-FUNCTIONAL: removing a declared input or output drops the Function Block's field with its flags
 * Wireframe: none (functional)
 * Design Decisions: FNCFG-9, CANVAS-211, VMGR-102
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.1.3.19
 *
 * Seeds (API, POST /tests and POST /functions; every name `zz-11541-s7-`, Tests deleted after each test,
 * the library Function with `cascade=true`): root variables `who`, `sink_a`, `sink_b` and a Function with
 * the inputs `keep_me`, `gone_whole`, `gone_tpl`, `gone_map` and the outputs `kept_out`, `gone_out`; its
 * body Log prints `keep_me` and a Variable Setter writes `kept_out`. The Function Block holds a literal
 * `keep_me`, `gone_whole` as {x} `who`, `gone_tpl` as a Template, `gone_map` with a typed literal entry and an
 * {x} entry, `kept_out` bound to `sink_a` and `gone_out` bound to `sink_b`. The Local case seeds a Local
 * Function; the Shared case a library Function and a Shared Function Block put in edit mode through its menu.
 * The removals go through the Variable Manager rows inside the Function flow.
 *
 * Pass Criteria:
 * 1. Local: after removing the three `gone_*` inputs and `gone_out` and saving, the stored Block keeps only
 *    `keep_me` in its values, no flag of a removed field (whole, template or entry), no item types of
 *    `gone_map`, and only the `kept_out` binding; the Function declares `keep_me` and `kept_out` alone.
 * 2. Shared draft: the same removals in the edit-mode draft store the same Block and a draft that declares
 *    `keep_me` and `kept_out` alone.
 * 3. Each saved Test runs and passes: the body prints `stay` and the root reads `sink=K` from the kept output.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { openTest, validateTest } from '../../helpers/fn-seed'
import {
  cleanUp,
  configOf,
  createFunction,
  createTest,
  libraryFunction,
  localFunctionBlock,
  logBlock,
  pickBlockMenuItem,
  setterBlock,
  sharedFunctionBlock,
  storedBlock,
  zzName,
  type BlockFields,
  type FunctionBody,
  type Rec,
} from '../../helpers/fn-block'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import {
  breadcrumbFunctionSegments,
  digIn,
  editModeOverlay,
  popToBreadcrumbSegment,
  runToEnd,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'

const FN_ID = 'fn-drop'
const GONE = ['gone_whole', 'gone_tpl', 'gone_map', 'gone_out'] as const

const BODY: FunctionBody = {
  inputs: [
    { name: 'keep_me', type: 'string', required: false, default: null, description: '' },
    { name: 'gone_whole', type: 'string', required: false, default: null, description: '' },
    { name: 'gone_tpl', type: 'string', required: false, default: null, description: '' },
    { name: 'gone_map', type: 'map', required: false, default: null, description: '' },
  ],
  outputs: [
    { name: 'kept_out', type: 'string', description: '' },
    { name: 'gone_out', type: 'string', description: '' },
  ],
  nodes: [logBlock('drop-log', 'Print Kept', 'keep_me'), setterBlock('drop-set', 'Write Kept', { kept_out: 'K' })],
}

const FIELDS: BlockFields = {
  values: {
    keep_me: 'stay',
    gone_whole: 'who',
    gone_tpl: 'Hi {{ who }}',
    gone_map: { lit: 'x', k: 'who' },
  },
  expressionFields: ['gone_whole', 'gone_map.k'],
  templateFields: ['gone_tpl'],
  elementTypes: { gone_map: { lit: 'string' } },
  outputBindings: { kept_out: 'sink_a', gone_out: 'sink_b' },
}

const VARIABLES: Rec = {
  who: { type: 'string', value: 'W', scope: 'test' },
  sink_a: { type: 'string', value: 'none', scope: 'test' },
  sink_b: { type: 'string', value: 'none', scope: 'test' },
}

const READ_SINK = logBlock('sink-log', 'Read Sink', "'sink=' + sink_a", { position: { x: 300, y: 360 } })

/** Remove a declared input or output through its Variable Manager row. */
async function removeThroughRow(page: Page, name: string): Promise<void> {
  const row = variableRow(page, name)
  await row.hover()
  await row.locator('[data-testid^="delete-button-"]').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(variableRow(page, name)).toHaveCount(0)
}

/** Drill into the Function, remove every `gone_*` declaration, go back to the root flow and save. */
async function removeAndSave(page: Page, testName: string): Promise<void> {
  await expandVariableManager(page)
  await digIn(page, FN_ID)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  await expect(variableRow(page, 'keep_me')).toHaveCount(1)
  for (const name of GONE) await removeThroughRow(page, name)
  await popToBreadcrumbSegment(page, testName)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
  await saveTest(page)
}

/** The stored Block keeps `keep_me` and `kept_out` only, with no flag of a removed field. */
async function expectFieldsDropped(request: APIRequestContext, testId: string): Promise<Rec> {
  const block = await storedBlock(request, testId, FN_ID)
  const config = configOf(block)
  expect(config.values, 'only the kept input keeps a value').toEqual({ keep_me: 'stay' })
  expect(block.expressionFields ?? [], 'no {x} flag of a removed field').toEqual([])
  expect(block.templateFields ?? [], 'no Template flag of a removed field').toEqual([])
  expect((block.elementTypes ?? {}) as Rec, 'no item types of the removed map').not.toHaveProperty('gone_map')
  expect(config.outputBindings, 'only the kept output keeps its binding').toEqual({ kept_out: 'sink_a' })
  return block
}

function declaredNames(holder: unknown, key: 'inputs' | 'outputs'): string[] {
  return (((holder as Rec)[key] ?? []) as Rec[]).map((entry) => String(entry.name))
}

async function expectRunPasses(page: Page): Promise<void> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  expect(verdict, formatEntries(entries)).toBe('passed')
  expectConsoleLine(entries, 'INFO', 'stay')
  expectConsoleLine(entries, 'INFO', 'sink=K')
}

test.describe('V-FN-INPUT-REMOVE-DROPS-FIELD-FUNCTIONAL: a removed declaration leaves the Function Block', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
  })

  test('Local Function: removing inputs and an output drops their fields and flags from the Block', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const name = zzName('drop-local')
    const testId = await createTest(request, {
      name,
      variables: VARIABLES,
      nodes: [localFunctionBlock(FN_ID, 'Drop_Fn', BODY, FIELDS), READ_SINK],
    })
    testIds.push(testId)
    expect((await validateTest(request, testId, 'run')).errors).toHaveLength(0)
    await openTest(page, testId)

    await test.step('the removals in the Function flow are saved', async () => {
      await removeAndSave(page, name)
    })

    await test.step('the stored Block and Function keep only what is still declared', async () => {
      const block = await expectFieldsDropped(request, testId)
      expect(declaredNames(block.localDefinition, 'inputs')).toEqual(['keep_me'])
      expect(declaredNames(block.localDefinition, 'outputs')).toEqual(['kept_out'])
    })

    await test.step('the saved Test runs with the kept field and output', async () => {
      await expectRunPasses(page)
    })
  })

  test('Shared draft: the same removals in edit mode drop the fields and flags from the Block', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const pin = await createFunction(request, libraryFunction(zzName('drop-lib'), BODY))
    functionIds.push(pin.functionId)
    const name = zzName('drop-shared')
    const testId = await createTest(request, {
      name,
      variables: VARIABLES,
      nodes: [sharedFunctionBlock(FN_ID, 'Drop_Fn', pin, FIELDS), READ_SINK],
    })
    testIds.push(testId)
    expect((await validateTest(request, testId, 'run')).errors).toHaveLength(0)
    await openTest(page, testId)

    await test.step('the Block enters edit mode and the removals in its draft are saved', async () => {
      await pickBlockMenuItem(page, FN_ID, /^Edit$/)
      await expect(editModeOverlay(page, FN_ID)).toBeVisible({ timeout: 10_000 })
      await removeAndSave(page, name)
    })

    await test.step('the stored Block and its draft keep only what is still declared', async () => {
      const block = await expectFieldsDropped(request, testId)
      expect(block.editMode, 'the Block is still in edit mode').toBe(true)
      expect(declaredNames(block.draft, 'inputs')).toEqual(['keep_me'])
      expect(declaredNames(block.draft, 'outputs')).toEqual(['kept_out'])
    })

    await test.step('the saved Test runs the draft with the kept field and output', async () => {
      await expectRunPasses(page)
    })
  })
})
