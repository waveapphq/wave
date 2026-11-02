/**
 * V-CANVAS-FN-PARAM-NULL: Function locals, inputs and outputs created null with Set to null
 * Design Decisions: VMGR-97, VMGR-98, VMGR-99, VMGR-104, VMGR-93
 * REQ: REQ-3.1.3.24, REQ-3.1.3.20, REQ-3.1.2.1, REQ-3.1.2.10, REQ-3.1.2.11
 *
 * Seeds (API, POST /tests): a `zz-` Test whose Start leads to a Local Function `fn1` holding one
 * body Log; the output test adds a Log after the Function and the caller variables `c_<type>`,
 * each holding a value that is not null. Every local, input and output is created through its
 * creation window; the body Log's message is set through its config sheet once the names exist;
 * the output bindings are made in the Function Block window; the Function is published from its
 * kebab. Each Test is deleted afterwards and the library Function with cascade=true.
 *
 * Pass Criteria:
 * 1. A Function local of every type ticked Set to null is created and its row reads null; it is
 *    stored as a plain `value: null` with no kind flag, reads null after a reload, and the body
 *    Log prints the null of every type.
 * 2. An input of every free-entry type ticked Set to null is created optional with its row reading
 *    null; it is stored with `default: null` and no kind flag, reads null after a reload, and with
 *    nothing given by the Function Block the body Log prints the null of every such type (a true /
 *    false input always declares a default, REQ-3.1.2.10).
 * 3. An output of every type ticked Set to null is created with its row reading null and stored
 *    with `default: null`; the body writes nothing, so after the run every caller variable bound
 *    to an output holds null: the session reads null and a Log after the Function prints it.
 * 4. On a String input, Create enum turns a ticked Set to null off and disables it, the Allowed
 *    values field and the default select replace the `null` field; Create enum off leaves Required
 *    on, which holds Set to null off until Required is unticked; the enum input is stored Required
 *    with its allowed values and the default picked.
 * 5. Null locals, inputs and outputs, every type once, keep their null through Save and a reload, and
 *    through Publish to Library: the library version stores them null with no kind flag and the
 *    Function View rows read null.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { pickEnum } from '../../helpers/config-sheet'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { getActiveSessionId, getSessionVariables, sessionValue } from '../../helpers/fixture-import'
import { createValidTest, localFunctionNode, logNode, openFunctionView, openTest, startEdge } from '../../helpers/fn-seed'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { expectNullLook } from '../../helpers/null-look'
import {
  createNullField,
  expandVariableManager,
  fillAllowedValues,
  openFunctionCreateModal,
  setCreateName,
  setCreateType,
  setToNull,
  setToNullCheckbox,
  setWindowCheckbox,
  setWindowValue,
  submitCreate,
  valueField,
  variableRow,
  windowCheckbox,
} from '../../helpers/variable-create'
import {
  breadcrumbFunctionSegments,
  digIn,
  openBlockSheet,
  popToBreadcrumbSegment,
  runToEnd,
  saveBlockSheet,
  saveTest,
  selectEnvironment,
  setBlockExpression,
} from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const
type VarType = (typeof TYPES)[number]

type ParamWindow = 'variable' | 'input' | 'output'

const FN_ID = 'fn1'
const INNER_ID = 'inner'
const AFTER_ID = 'after'

/** Caller variables the outputs bind to, each holding a value that is not null before the run. */
const CALLER_SEEDS: Record<string, { type: VarType; value: unknown }> = {
  c_string: { type: 'string', value: 'seed' },
  c_integer: { type: 'integer', value: 7 },
  c_float: { type: 'float', value: 2.5 },
  c_boolean: { type: 'boolean', value: true },
  c_array: { type: 'array', value: [1, 2] },
  c_map: { type: 'map', value: { k: 'v' } },
  c_table: { type: 'table', value: [{ col1: 'row1' }] },
}

/** The input types a Function input can be created null in: a true / false input declares a default (REQ-3.1.2.10). */
const INPUT_TYPES: readonly VarType[] = TYPES.filter((type) => type !== 'boolean')

/** A Log message reading one name per type into one map, so one line names each null. */
function nullMapExpression(prefix: string, types: readonly VarType[] = TYPES): string {
  return `{${types.map((type) => `'${type}': ${prefix}_${type}`).join(', ')}}`
}

/** WAVE's print form of that map when every name holds null. */
function nullMapLine(types: readonly VarType[] = TYPES): string {
  return `{${types.map((type) => `"${type}":null`).join(',')}}`
}

type Rec = Record<string, unknown>

interface FunctionDefinition {
  variables: Rec[]
  inputs: Rec[]
  outputs: Rec[]
}

interface StoredFunction extends FunctionDefinition {
  /** The Function Block's field values. */
  fields: Record<string, unknown>
  outputBindings: Record<string, unknown>
}

/** One stored local or parameter, reduced to the keys this spec checks. */
interface NullShape {
  type: unknown
  hasValue: boolean
  value: unknown
  isExpression?: unknown
  isTemplate?: unknown
}

function uniqueTag(): string {
  return randomUUID().slice(0, 8)
}

async function cleanup(request: APIRequestContext, testId: string, libraryName = ''): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  if (!libraryName) return
  const entry = await findLibraryFunction(request, libraryName).catch(() => undefined)
  if (entry) await request.delete(`${BACKEND_URL}/functions/${entry.id}?cascade=true`).catch(() => undefined)
}

async function findLibraryFunction(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; name: string } | undefined> {
  const resp = await request.get(`${BACKEND_URL}/functions?q=${encodeURIComponent(name)}`)
  expect(resp.ok(), `GET /functions failed: ${resp.status()}`).toBeTruthy()
  const rows = ((await resp.json()).data ?? []) as Array<{ id: string; name: string }>
  return rows.find((row) => row.name === name)
}

/** Start -> Local Function `fn1` (body: one Log); with `caller`, a Log after it and the `c_<type>` variables. */
async function seedTest(request: APIRequestContext, name: string, caller = false): Promise<string> {
  const fn = localFunctionNode(FN_ID, 'NullFn', {
    nodes: [logNode(INNER_ID, 'Body Log', "'body'")],
    edges: [startEdge(INNER_ID)],
  })
  const nodes = [fn]
  const edges = [startEdge(FN_ID)]
  const variables: Record<string, unknown> = {}
  if (caller) {
    nodes.push(logNode(AFTER_ID, 'After Log', nullMapExpression('c'), { x: 500, y: 200 }))
    edges.push({ id: 'e-fn-after', source: FN_ID, target: AFTER_ID })
    Object.assign(variables, CALLER_SEEDS)
  }
  return createValidTest(request, { name, nodes, edges, variables })
}

async function readStoredFunction(request: APIRequestContext, testId: string): Promise<StoredFunction> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.workflow.nodes as Array<{ id: string; data: Rec }>
  const data = nodes.find((node) => node.id === FN_ID)?.data ?? {}
  const def = (data.localDefinition ?? {}) as Partial<FunctionDefinition>
  const config = (data.config ?? {}) as { values?: Record<string, unknown>; outputBindings?: Record<string, unknown> }
  return {
    variables: def.variables ?? [],
    inputs: def.inputs ?? [],
    outputs: def.outputs ?? [],
    fields: config.values ?? {},
    outputBindings: config.outputBindings ?? {},
  }
}

function nullShape(def: FunctionDefinition, window: ParamWindow, name: string): NullShape {
  const list = window === 'variable' ? def.variables : window === 'input' ? def.inputs : def.outputs
  const entry = list.find((item) => item.name === name)
  expect(entry, `${name} is stored`).toBeTruthy()
  const found = entry as Rec
  const key = window === 'variable' ? 'value' : 'default'
  return {
    type: found.type,
    hasValue: key in found,
    value: found[key],
    isExpression: found.isExpression,
    isTemplate: found.isTemplate,
  }
}

function expectStoredNull(def: FunctionDefinition, window: ParamWindow, name: string, type: VarType): void {
  expect(nullShape(def, window, name), `${name} is stored as a plain null`).toEqual({
    type,
    hasValue: true,
    value: null,
  })
}

function valueCell(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="variable-value-"]')
}

async function drillIn(page: Page): Promise<void> {
  await digIn(page, FN_ID)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  await expandVariableManager(page)
}

async function popOut(page: Page, testName: string): Promise<void> {
  await popToBreadcrumbSegment(page, testName)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
}

/** Per VMGR-97: create one local, input or output with Set to null ticked, and check its window and row. */
async function createNull(page: Page, window: ParamWindow, name: string, type: VarType): Promise<void> {
  const modal = await openFunctionCreateModal(page, window)
  await setCreateName(page, name, modal)
  if (type !== 'string') await setCreateType(page, type, modal)
  await setToNull(page, modal)
  await expect(modal.locator('[data-testid="create-kind-select"]'), `${name}: Kind is hidden`).toHaveCount(0)
  await expectNullLook(createNullField(page, modal), `${name}: the null field`)
  if (window === 'input') {
    await expect(modal.locator('[data-testid="param-required-checkbox"]'), `${name} stays optional`).not.toBeChecked()
  }
  await submitCreate(page, modal)
  await expect(modal).toBeHidden()
  await expectNullLook(valueCell(page, name), `the ${name} row`)
  await expect(variableRow(page, name).locator('[data-testid^="type-badge-"]')).toHaveText(type)
}

/** Reopen the saved Test, drill in, and check every named row still reads null. */
async function expectRowsNullAfterReload(page: Page, testId: string, names: readonly string[]): Promise<void> {
  await openTest(page, testId)
  await drillIn(page)
  for (const name of names) await expectNullLook(valueCell(page, name), `the reloaded ${name} row`)
}

/** Run the saved Test from the Test scope and return the console entries of a passing run. */
async function runPassing(page: Page, testName: string) {
  await popOut(page, testName)
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
  return entries
}

/** Publish from the kebab; returns the library's answer to the publish request. */
async function publishToLibrary(
  page: Page,
  nodeId: string,
  name: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  await clickNodeKebabItem(page, nodeId, 'Publish to Library')
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.locator('[data-testid="publish-name-input"]').fill(name)
  const answer = page.waitForResponse(
    (resp) => resp.request().method() === 'POST' && /\/functions(\/publish)?$/.test(new URL(resp.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Publish' }).click()
  const resp = await answer
  return { ok: resp.ok(), status: resp.status(), body: await resp.text() }
}

test.describe('V-CANVAS-FN-PARAM-NULL: Function locals and parameters created null', () => {
  let testId = ''
  let libraryName = ''

  test.afterEach(async ({ request }) => {
    await cleanup(request, testId, libraryName)
    testId = ''
    libraryName = ''
  })

  test('a Function local of every type is created null and the body reads null', async ({ page, request }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-local-null-${uniqueTag()}`
    testId = await seedTest(request, testName)
    await openTest(page, testId)
    await drillIn(page)
    const names = TYPES.map((type) => `l_${type}`)

    await test.step('VMGR-97: each type is created null in the Function local window', async () => {
      for (const type of TYPES) await createNull(page, 'variable', `l_${type}`, type)
      await setBlockExpression(page, INNER_ID, 'message', nullMapExpression('l'))
    })

    await test.step('REQ-3.1.3.24: the save stores each local as a plain null', async () => {
      await popOut(page, testName)
      await saveTest(page)
      const stored = await readStoredFunction(request, testId)
      for (const type of TYPES) expectStoredNull(stored, 'variable', `l_${type}`, type)
    })

    await test.step('VMGR-93: the reloaded rows read null', async () => {
      await expectRowsNullAfterReload(page, testId, names)
    })

    await test.step('REQ-3.1.3.20: the body reads null in every local', async () => {
      const entries = await runPassing(page, testName)
      expectConsoleLine(entries, 'INFO', nullMapLine())
      await expectNodeStatus(page, FN_ID, 'success')
    })
  })

  test('an input of every free-entry type created null reaches the body as null when the Function Block gives nothing', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-input-null-${uniqueTag()}`
    testId = await seedTest(request, testName)
    await openTest(page, testId)
    await drillIn(page)
    const names = INPUT_TYPES.map((type) => `i_${type}`)

    await test.step('VMGR-97: each free-entry type is created null in the Input window', async () => {
      for (const type of INPUT_TYPES) {
        await createNull(page, 'input', `i_${type}`, type)
        await expect(page.locator(`[data-testid="in-badge-param:input:i_${type}"]`)).toBeVisible()
      }
      await setBlockExpression(page, INNER_ID, 'message', nullMapExpression('i', INPUT_TYPES))
    })

    await test.step('REQ-3.1.2.10: the save stores each input optional with a null default', async () => {
      await popOut(page, testName)
      await saveTest(page)
      const stored = await readStoredFunction(request, testId)
      for (const type of INPUT_TYPES) {
        expectStoredNull(stored, 'input', `i_${type}`, type)
        const entry = stored.inputs.find((item) => item.name === `i_${type}`) as Rec
        expect(entry.required ?? false, `i_${type} is optional`).toBe(false)
        expect(stored.fields[`i_${type}`], `the Function Block holds nothing for i_${type}`).toBeUndefined()
      }
    })

    await test.step('VMGR-93: the reloaded rows read null', async () => {
      await expectRowsNullAfterReload(page, testId, names)
    })

    await test.step('REQ-3.1.3.20: with nothing given the body reads null in every input', async () => {
      const entries = await runPassing(page, testName)
      expectConsoleLine(entries, 'INFO', nullMapLine(INPUT_TYPES))
      await expectNodeStatus(page, FN_ID, 'success')
    })
  })

  test('an output of every type created null leaves the bound caller variable null', async ({ page, request }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const testName = `zz-fn-output-null-${uniqueTag()}`
    testId = await seedTest(request, testName, true)
    await openTest(page, testId)
    await drillIn(page)
    const names = TYPES.map((type) => `o_${type}`)

    await test.step('VMGR-97: each type is created null in the Output window', async () => {
      for (const type of TYPES) {
        await createNull(page, 'output', `o_${type}`, type)
        await expect(page.locator(`[data-testid="out-badge-param:output:o_${type}"]`)).toBeVisible()
      }
    })

    await test.step('each output is bound to its caller variable in the Function Block window', async () => {
      await popOut(page, testName)
      const sheet = await openBlockSheet(page, FN_ID)
      for (const type of TYPES) {
        const combobox = sheet.locator(`[data-testid="output-row-o_${type}"] [role="combobox"]`).first()
        await combobox.scrollIntoViewIfNeeded()
        await combobox.click()
        await combobox.fill(`c_${type}`)
        await combobox.press('Tab')
        await expect(combobox).toHaveValue(`c_${type}`)
      }
      await saveBlockSheet(sheet)
    })

    await test.step('REQ-3.1.3.24: the save stores each output with a null default and its binding', async () => {
      await saveTest(page)
      const stored = await readStoredFunction(request, testId)
      for (const type of TYPES) {
        expectStoredNull(stored, 'output', `o_${type}`, type)
        expect(stored.outputBindings[`o_${type}`], `o_${type} binds c_${type}`).toBe(`c_${type}`)
      }
    })

    await test.step('VMGR-93: the reloaded rows read null', async () => {
      await expectRowsNullAfterReload(page, testId, names)
    })

    await test.step('REQ-3.1.3.20: the body writes nothing, so every bound caller variable holds null', async () => {
      const entries = await runPassing(page, testName)
      expectConsoleLine(entries, 'INFO', nullMapLine())
      await expectNodeStatus(page, AFTER_ID, 'success')
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      for (const type of TYPES) {
        expect(sessionValue(variables, `c_${type}`), `c_${type} holds null after the Function Block runs`).toBeNull()
      }
    })
  })

  test('Create enum turns Set to null off and disables it', async ({ page, request }) => {
    test.setTimeout(180_000)
    const testName = `zz-fn-enum-null-${uniqueTag()}`
    testId = await seedTest(request, testName)
    await openTest(page, testId)
    await drillIn(page)

    await test.step('VMGR-104: Create enum unticks and disables Set to null; off again, it is enabled', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await setCreateName(page, 'i_level', modal)
      await setToNull(page, modal)
      const enumBox = windowCheckbox(modal, 'create-enum')
      const nullBox = setToNullCheckbox(page, modal)
      await enumBox.click()
      await expect(enumBox).toBeChecked()
      await expect(nullBox, 'an enum input is never null').not.toBeChecked()
      await expect(nullBox, 'Set to null is off while enum is set').toBeDisabled()
      await expect(createNullField(page, modal)).toHaveCount(0)
      await expect(valueField(modal, 'allowed-values'), 'the Allowed values field takes its place').toBeVisible()
      await expect(modal.locator('[data-testid="enum-value-select"]'), 'the default is picked from them').toBeVisible()

      // Per VMGR-103 / VMGR-104: enum off leaves Required on, which still holds Set to null off.
      await enumBox.click()
      await expect(enumBox).not.toBeChecked()
      await expect(windowCheckbox(modal, 'required'), 'Required stays ticked with enum off').toBeChecked()
      await expect(nullBox, 'Set to null is off while Required is set').toBeDisabled()
      await expect(modal.getByText('off while Required is set', { exact: true })).toBeVisible()
      await setWindowCheckbox(modal, 'required', false)
      await expect(nullBox, 'Set to null is enabled again with enum and Required off').toBeEnabled()

      await enumBox.click()
      await expect(nullBox).toBeDisabled()
      await fillAllowedValues(page, ['low', 'high'], modal)
      await setWindowValue(page, modal, 'low')
      await submitCreate(page, modal)
      await expect(modal).toBeHidden()
      await expect(variableRow(page, 'i_level')).toBeVisible()
    })

    await test.step('VMGR-104: the enum input is stored Required with its allowed values and its default', async () => {
      await popOut(page, testName)
      // A Required input the Function Block sets nothing for refuses the Test save, so the Block picks one.
      const sheet = await openBlockSheet(page, FN_ID)
      await pickEnum(page, sheet, 'i_level', 'high')
      await saveBlockSheet(sheet)
      await saveTest(page)
      const stored = await readStoredFunction(request, testId)
      const entry = stored.inputs.find((item) => item.name === 'i_level') as Rec
      expect(entry, 'i_level is stored').toBeTruthy()
      expect(entry.type, 'an enum input keeps the type of its values').toBe('string')
      expect(entry.required, 'an enum input is Required').toBe(true)
      expect(entry.enumValues, 'the allowed values are stored in order').toEqual(['low', 'high'])
      expect(entry.default, 'the default picked is stored').toBe('low')
    })
  })

  test('null defaults survive save, reload and publish', async ({ page, request }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const tag = uniqueTag()
    const testName = `zz-fn-null-publish-${tag}`
    libraryName = `zz-null-publish-${tag}`
    testId = await seedTest(request, testName)
    await openTest(page, testId)
    await drillIn(page)

    // Every type once across the three windows.
    const items: ReadonlyArray<{ window: ParamWindow; name: string; type: VarType }> = [
      { window: 'variable', name: 'l_string', type: 'string' },
      { window: 'variable', name: 'l_array', type: 'array' },
      { window: 'input', name: 'i_integer', type: 'integer' },
      { window: 'input', name: 'i_map', type: 'map' },
      { window: 'variable', name: 'l_boolean', type: 'boolean' },
      { window: 'output', name: 'o_float', type: 'float' },
      { window: 'output', name: 'o_table', type: 'table' },
    ]
    const names = items.map((item) => item.name)

    await test.step('VMGR-97: one null item of every type across the local, input and output windows', async () => {
      for (const item of items) await createNull(page, item.window, item.name, item.type)
    })

    await test.step('REQ-3.1.3.24: Save stores every item as a plain null', async () => {
      await popOut(page, testName)
      await saveTest(page)
      const stored = await readStoredFunction(request, testId)
      for (const item of items) expectStoredNull(stored, item.window, item.name, item.type)
    })

    await test.step('VMGR-93: the reloaded rows read null', async () => {
      await expectRowsNullAfterReload(page, testId, names)
      await popOut(page, testName)
    })

    const functionId = await test.step('REQ-3.1.2.1: Publish to Library keeps every null', async () => {
      const published = await publishToLibrary(page, FN_ID, libraryName)
      expect(published.ok, `publish answered ${published.status}: ${published.body}`).toBe(true)
      const entry = await findLibraryFunction(request, libraryName)
      expect(entry, `library entry ${libraryName} exists after publish`).toBeTruthy()
      const resp = await request.get(`${BACKEND_URL}/functions/${entry!.id}?version=1.0.0`)
      expect(resp.ok(), `GET /functions/${entry!.id}?version=1.0.0 failed: ${resp.status()}`).toBeTruthy()
      const def = (await resp.json()).data as Partial<FunctionDefinition>
      const library: FunctionDefinition = {
        variables: def.variables ?? [],
        inputs: def.inputs ?? [],
        outputs: def.outputs ?? [],
      }
      for (const item of items) expectStoredNull(library, item.window, item.name, item.type)
      return entry!.id
    })

    await test.step('VMGR-93: the library Function View rows read null', async () => {
      await openFunctionView(page, functionId, '1.0.0')
      await expandVariableManager(page)
      for (const name of names) await expectNullLook(valueCell(page, name), `the library ${name} row`)
    })
  })
})
