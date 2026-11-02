/**
 * V-VMGR-CREATE-SET-TO-NULL: Set to null in the four creation windows
 * Design Decisions: VMGR-97, VMGR-98, VMGR-93, VMGR-103, VMGR-111
 * REQ: REQ-3.1.3.24, REQ-3.1.3.20
 *
 * Seeds (API, POST /tests): test 1 a blank `zz-` Test; tests 2-5 a `zz-` Test holding one Local
 * Function `fn1` with one inner Log. Every Test variable, Function local, input and output is
 * created through its creation window; the Log of test 1 is dropped from the palette. Each Test
 * is deleted afterwards.
 *
 * Pass Criteria:
 * 1. A Test variable of every type created with Set to null ticked reads null in the null look,
 *    is stored as a plain `{type, value: null}` with no kind flag, reads null again after a
 *    reload, and a run sees null: the session holds null and a Log prints the null of each type.
 * 2. Ticked, the Variable, Function local, Input and Output windows hide Kind and the value field,
 *    keep the Open editor button disabled, and show one `null` field; unticked again they bring back the Kind
 *    (Literal) and value held before (a String's text, a Map's text, a Table's rows), and Create
 *    stores that value (a Table with its column types).
 * 3. In every window an emptied integer or float box refuses while it has focus
 *    (`Enter a valid <type> value`, Create off, Set to null unticked) and ticks Set to null when it
 *    loses focus; the item is created and stored null.
 * 4. Set to null is hidden while Kind is Expression or Template and shows again on Literal; the item
 *    is created with its kind, its row shows the kind badge, and it is stored with its source and
 *    kind flag (VMGR-111).
 * 5. A secret created null shows the null look with its SECRET badge, never the mask, before and
 *    after a reload, and is stored null with its secret flag. On an input, Mark as secret forces
 *    Set to null: the box carries aria-disabled="true" and a click or Space leaves it ticked, and
 *    the `null` field is a read-only field marked aria-disabled.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { createValidTest, localFunctionNode, logNode, openTest, startEdge } from '../../helpers/fn-seed'
import { getActiveSessionId, getSessionVariables, sessionValue } from '../../helpers/fixture-import'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { expectNullLook } from '../../helpers/null-look'
import { SECRET_MASK } from '../../helpers/secret-canary'
import {
  createNullField,
  expandVariableManager,
  expectWindowValue,
  insertCodeValue,
  insertCreateCode,
  openCreateModal,
  openFunctionCreateModal,
  setCreateKind,
  setCreateName,
  setCreateType,
  setToNull,
  setToNullCheckbox,
  submitCreate,
  valueField,
  variableRow,
} from '../../helpers/variable-create'
import {
  breadcrumbFunctionSegments,
  digIn,
  dropBelowStart,
  popToBreadcrumbSegment,
  runToEnd,
  saveTest,
  selectEnvironment,
  setBlockExpression,
} from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const

type WindowKind = 'variable' | 'local' | 'input' | 'output'

interface CreationWindow {
  kind: WindowKind
  label: string
  /** Name prefix, so the items of one test never collide. */
  prefix: string
  /** The Input window has no Kind select: an input is always a literal. */
  hasKind: boolean
}

const WINDOWS: readonly CreationWindow[] = [
  { kind: 'variable', label: 'Variable window', prefix: 'v', hasKind: true },
  { kind: 'local', label: 'Function local window', prefix: 'l', hasKind: true },
  { kind: 'input', label: 'Input window', prefix: 'i', hasKind: false },
  { kind: 'output', label: 'Output window', prefix: 'o', hasKind: true },
]

const KIND_WINDOWS = WINDOWS.filter((w) => w.hasKind)

const FN_ID = 'fn1'

/** A Log message reading every type's variable into one map, so one line names each null. */
function nullMapExpression(prefix: string): string {
  return `{${TYPES.map((type) => `'${type}': ${prefix}_${type}`).join(', ')}}`
}

/** WAVE's print form of that map when every variable holds null. */
const NULL_MAP_LINE = `{${TYPES.map((type) => `"${type}":null`).join(',')}}`

const TEMPLATE_TEXT = 'held template text'
const STRING_TEXT = 'held default text'
const MAP_CODE = '{"k": "v", "n": 2}'
const TABLE_CODE = '[{"id": 1, "name": "a"}]'

type Rec = Record<string, unknown>

interface StoredTest {
  variables: Record<string, Rec>
  locals: Rec[]
  inputs: Rec[]
  outputs: Rec[]
}

/** What one window stored for one item, reduced to the keys this spec checks. */
interface StoredShape {
  type: unknown
  /** Variables and locals keep `value`, parameters keep `default`. */
  hasValue: boolean
  value: unknown
  isExpression?: unknown
  isTemplate?: unknown
  secret?: unknown
  /** A map or list keeps each element's declared type beside its exact text (REQ-3.1.3.19). */
  elementTypes?: unknown
}

function uniqueName(label: string): string {
  return `zz-${label}-${randomUUID().slice(0, 8)}`
}

async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

/** A Test holding one Local Function, the shape V-VMGR-CREATE-01 seeds. */
async function seedWithFunction(request: APIRequestContext, name: string): Promise<string> {
  return createValidTest(request, {
    name,
    nodes: [
      logNode('log1', 'Log', '"ok"'),
      localFunctionNode(FN_ID, 'MyFn', {
        nodes: [logNode('inner', 'Inner', '"x"')],
        edges: [startEdge('inner')],
      }),
    ],
    edges: [startEdge('log1')],
  })
}

async function readStored(request: APIRequestContext, testId: string): Promise<StoredTest> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const data = (await resp.json()).data as {
    variables?: Record<string, Rec>
    workflow: { nodes: Array<{ id: string; data: { localDefinition?: Rec } }> }
  }
  const fn = data.workflow.nodes.find((node) => node.id === FN_ID)
  const def = (fn?.data.localDefinition ?? {}) as { variables?: Rec[]; inputs?: Rec[]; outputs?: Rec[] }
  return {
    variables: data.variables ?? {},
    locals: def.variables ?? [],
    inputs: def.inputs ?? [],
    outputs: def.outputs ?? [],
  }
}

function storedShape(stored: StoredTest, kind: WindowKind, name: string): StoredShape {
  const byName = (list: Rec[]) => list.find((entry) => entry.name === name)
  const entry =
    kind === 'variable'
      ? stored.variables[name]
      : byName(kind === 'local' ? stored.locals : kind === 'input' ? stored.inputs : stored.outputs)
  expect(entry, `${name} is stored`).toBeTruthy()
  const key = kind === 'input' || kind === 'output' ? 'default' : 'value'
  const found = entry as Rec
  return {
    type: found.type,
    hasValue: key in found,
    value: found[key],
    isExpression: found.isExpression,
    isTemplate: found.isTemplate,
    secret: found.secret,
    elementTypes: found.elementTypes,
  }
}

function valueCell(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="variable-value-"]')
}

function badge(page: Page, name: string, kind: 'type' | 'secret' | 'expr' | 'template'): Locator {
  return variableRow(page, name).locator(`[data-testid^="${kind}-badge-"]`)
}

/** Stand in the scope a window creates into: the Test for the Variable window, `fn1` for the rest. */
async function enterScope(page: Page, testName: string, kind: WindowKind): Promise<void> {
  const drilled = (await breadcrumbFunctionSegments(page).count()) > 0
  if (kind === 'variable' && drilled) {
    await popToBreadcrumbSegment(page, testName)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
  } else if (kind !== 'variable' && !drilled) {
    await digIn(page, FN_ID)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  }
  await expandVariableManager(page)
}

async function openWindow(page: Page, kind: WindowKind): Promise<Locator> {
  if (kind === 'variable') return openCreateModal(page)
  return openFunctionCreateModal(page, kind === 'local' ? 'variable' : kind)
}

/** Click Create and wait for the window to close and the row to appear. */
async function create(page: Page, modal: Locator, name: string): Promise<void> {
  await submitCreate(page, modal)
  await expect(modal).toBeHidden()
  await expect(variableRow(page, name)).toBeVisible()
}

/** Pop to the Test, Save it, and read what the server stored. */
async function saveAndRead(
  page: Page,
  request: APIRequestContext,
  testName: string,
  testId: string,
): Promise<StoredTest> {
  await enterScope(page, testName, 'variable')
  await saveTest(page)
  return readStored(request, testId)
}

/** Type a value into the window's code editor and leave it, closing any suggestion list. */
async function typeCode(page: Page, modal: Locator, text: string): Promise<void> {
  await insertCodeValue(page, text, modal)
  await leaveExpressionEditor(modal)
}

/** Per VMGR-97 and VMGR-111: a ticked window shows one `null` field, its Open editor kept but off, and no other value control. */
async function expectTickedLook(modal: Locator, window: CreationWindow, what: string): Promise<void> {
  await expect(modal.locator('[data-testid="create-kind-select"]'), `${what}: Kind is hidden`).toHaveCount(0)
  const field = valueField(modal)
  await expect(field.locator('input:not([data-testid="create-null-field"])'), `${what}: the text box is gone`).toHaveCount(0)
  await expect(field.locator('.cm-content'), `${what}: the code editor is gone`).toHaveCount(0)
  const openEditor = modal.locator('[data-testid="open-value-editor-button"]')
  await expect(openEditor, `${what}: Open editor stays`).toBeVisible()
  await expect(openEditor, `${what}: Open editor is off while the value is null`).toBeDisabled()
  for (const testId of ['scalar-edit-input', 'enum-value-select']) {
    await expect(modal.locator(`[data-testid="${testId}"]`), `${what}: ${testId} is gone`).toHaveCount(0)
  }
  await expectNullLook(modal.locator('[data-testid="create-null-field"]'), `${what}: the null field`)
  await expect(modal.locator('[data-testid="create-submit-button"]'), `${what}: Create`).toBeEnabled()
  // The Type select stays where it was in every window.
  await expect(modal.locator('[data-testid="create-type-select"]'), `${what} (${window.label})`).toBeVisible()
}

async function untick(modal: Locator): Promise<void> {
  const box = modal.locator('[data-testid="create-set-to-null-checkbox"]')
  await box.click()
  await expect(box).not.toBeChecked()
  await expect(modal.locator('[data-testid="create-null-field"]')).toHaveCount(0)
}

test.describe('V-VMGR-CREATE-SET-TO-NULL: Set to null in the creation windows', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await deleteTest(request, testId)
    testId = ''
  })

  test('every type is created null with Set to null and reads null after save and reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    testId = await createValidTest(request, { name: uniqueName('set-to-null-types'), nodes: [] })
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('VMGR-97: each type is ticked Set to null in the Variable window and created', async () => {
      for (const type of TYPES) {
        const name = `n_${type}`
        const modal = await openCreateModal(page)
        await setCreateName(page, name, modal)
        if (type !== 'string') await setCreateType(page, type, modal)
        await setToNull(page, modal)
        await expect(modal.locator('[data-testid="create-kind-select"]'), `a ticked ${type} hides Kind`).toHaveCount(0)
        await expectNullLook(createNullField(page, modal), `the ticked ${type} window's null field`)
        await create(page, modal, name)
        await expectNullLook(valueCell(page, name), `the ${name} row`)
        await expect(badge(page, name, 'type'), `${name} keeps its type`).toHaveText(type)
      }
    })

    const logId = await test.step('a Log under Start reads every variable', async () => {
      const id = await dropBelowStart(page, 'log')
      await setBlockExpression(page, id, 'message', nullMapExpression('n'))
      return id
    })

    await test.step('REQ-3.1.3.24: the save stores a plain null with no kind flag', async () => {
      await saveTest(page)
      const stored = await readStored(request, testId)
      for (const type of TYPES) {
        expect(storedShape(stored, 'variable', `n_${type}`), `n_${type} is stored null`).toEqual({
          type,
          hasValue: true,
          value: null,
        })
      }
    })

    await test.step('VMGR-93: after a reload every row still reads null', async () => {
      await openTest(page, testId)
      await expandVariableManager(page)
      for (const type of TYPES) {
        await expectNullLook(valueCell(page, `n_${type}`), `the reloaded n_${type} row`)
      }
    })

    await test.step('REQ-3.1.3.20: the run sees null in every variable', async () => {
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expectConsoleLine(entries, 'INFO', NULL_MAP_LINE)
      expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
      await expectNodeStatus(page, logId, 'success')
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      for (const type of TYPES) {
        expect(sessionValue(variables, `n_${type}`), `n_${type} holds null in the run`).toBeNull()
      }
    })
  })

  test('unticking Set to null brings back the kind and value the window held', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    const testName = uniqueName('set-to-null-restore')
    testId = await seedWithFunction(request, testName)
    await openTest(page, testId)

    for (const window of WINDOWS) {
      await enterScope(page, testName, window.kind)
      const p = window.prefix

      await test.step(`VMGR-97 ${window.label}: a String's text comes back`, async () => {
        const modal = await openWindow(page, window.kind)
        await setCreateName(page, `${p}_text`, modal)
        await typeCode(page, modal, STRING_TEXT)
        const openEditor = modal.locator('[data-testid="open-value-editor-button"]')
        await expect(openEditor, 'a literal String offers Open editor').toBeVisible()
        await setToNull(page, modal)
        await expectTickedLook(modal, window, `${window.label}, String ticked`)
        await untick(modal)
        if (window.hasKind) {
          await expect(modal.locator('[data-testid="create-kind-select"]'), 'Kind comes back on Literal').toHaveText(
            'Literal',
          )
        }
        await expect(openEditor, 'Open editor comes back on').toBeEnabled()
        await expectWindowValue(modal, STRING_TEXT)
        await create(page, modal, `${p}_text`)
      })

      await test.step(`VMGR-97 ${window.label}: a Map comes back with its text`, async () => {
        const modal = await openWindow(page, window.kind)
        await setCreateName(page, `${p}_map`, modal)
        await setCreateType(page, 'map', modal)
        await insertCreateCode(page, MAP_CODE, modal)
        await expectWindowValue(modal, MAP_CODE)
        await setToNull(page, modal)
        await expectTickedLook(modal, window, `${window.label}, Map ticked`)
        await untick(modal)
        await expectWindowValue(modal, MAP_CODE)
        await create(page, modal, `${p}_map`)
        await expect(valueCell(page, `${p}_map`)).toHaveText('{2 keys}')
      })

      await test.step(`VMGR-97 ${window.label}: a Table comes back with its rows`, async () => {
        const modal = await openWindow(page, window.kind)
        await setCreateName(page, `${p}_tbl`, modal)
        await setCreateType(page, 'table', modal)
        await insertCreateCode(page, TABLE_CODE, modal)
        await expectWindowValue(modal, TABLE_CODE)
        await setToNull(page, modal)
        await expectTickedLook(modal, window, `${window.label}, Table ticked`)
        await untick(modal)
        await expectWindowValue(modal, TABLE_CODE)
        await create(page, modal, `${p}_tbl`)
        await expect(valueCell(page, `${p}_tbl`)).toHaveText('1×2 table')
      })
    }

    await test.step('VMGR-97: Create stores the value the untick brought back', async () => {
      const stored = await saveAndRead(page, request, testName, testId)
      for (const window of WINDOWS) {
        const p = window.prefix
        const text = storedShape(stored, window.kind, `${p}_text`)
        expect(text, `${p}_text keeps its text`).toEqual({
          type: 'string',
          hasValue: true,
          value: STRING_TEXT,
        })
        const map = storedShape(stored, window.kind, `${p}_map`)
        expect(map.value, `${p}_map keeps its entries as exact text`).toEqual({ k: 'v', n: '2' })
        expect(map.elementTypes, `${p}_map keeps each entry's type`).toEqual({ k: 'string', n: 'integer' })
        // REQ-3.5.5.4: a table is stored with its column types.
        const table = storedShape(stored, window.kind, `${p}_tbl`).value as { columns: unknown; rows: unknown[][] }
        expect(table.columns, `${p}_tbl keeps its typed columns`).toEqual([
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'string' },
        ])
        expect(table.rows, `${p}_tbl keeps its one row`).toHaveLength(1)
        expect(String(table.rows[0][0]), `${p}_tbl keeps its id cell`).toBe('1')
        expect(table.rows[0][1], `${p}_tbl keeps its name cell`).toBe('a')
      }
    })
  })

  test('an emptied integer or float box ticks Set to null when it loses focus', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    const testName = uniqueName('set-to-null-blur')
    testId = await seedWithFunction(request, testName)
    await openTest(page, testId)

    for (const window of WINDOWS) {
      await enterScope(page, testName, window.kind)
      for (const type of ['integer', 'float'] as const) {
        await test.step(`VMGR-97 ${window.label}: an emptied ${type} box`, async () => {
          const name = `${window.prefix}_${type}_blur`
          const modal = await openWindow(page, window.kind)
          await setCreateName(page, name, modal)
          await setCreateType(page, type, modal)
          const box = modal.locator('[data-testid="scalar-edit-input"]')
          const submit = modal.locator('[data-testid="create-submit-button"]')
          const nullBox = setToNullCheckbox(page, modal)
          await box.fill('5')
          await box.fill('')
          await expect(box, 'the emptied box keeps focus').toBeFocused()
          await expect(modal.locator('[data-testid="create-validation"]')).toContainText(`Enter a valid ${type} value`)
          await expect(submit, 'Create waits while the box is empty and focused').toBeDisabled()
          await expect(nullBox, 'nothing ticks before the box loses focus').not.toBeChecked()
          await box.blur()
          await expect(nullBox, 'losing focus ticks Set to null').toBeChecked()
          await expectNullLook(createNullField(page, modal), `${name}: the null field`)
          await expect(submit).toBeEnabled()
          await create(page, modal, name)
          await expectNullLook(valueCell(page, name), `the ${name} row`)
        })
      }
    }

    await test.step('REQ-3.1.3.24: each emptied box is stored null', async () => {
      const stored = await saveAndRead(page, request, testName, testId)
      for (const window of WINDOWS) {
        for (const type of ['integer', 'float'] as const) {
          expect(storedShape(stored, window.kind, `${window.prefix}_${type}_blur`)).toEqual({
            type,
            hasValue: true,
            value: null,
          })
        }
      }
    })
  })

  test('Set to null is hidden while Kind is Expression or Template', async ({ page, request }) => {
    test.setTimeout(300_000)
    const testName = uniqueName('set-to-null-kind')
    testId = await seedWithFunction(request, testName)
    await openTest(page, testId)

    const cases = [
      { suffix: 'expr', type: 'integer', kind: 'Expression', text: '1 + 2', badge: 'expr' },
      { suffix: 'tpl', type: 'string', kind: 'Template', text: TEMPLATE_TEXT, badge: 'template' },
    ] as const

    for (const window of KIND_WINDOWS) {
      await enterScope(page, testName, window.kind)
      for (const c of cases) {
        await test.step(`VMGR-111 ${window.label}: ${c.kind} hides Set to null`, async () => {
          const name = `${window.prefix}_${c.suffix}`
          const modal = await openWindow(page, window.kind)
          const nullBox = setToNullCheckbox(page, modal)
          await setCreateName(page, name, modal)
          if (c.type !== 'string') await setCreateType(page, c.type, modal)
          await setCreateKind(page, c.kind, modal)
          await expect(nullBox, `${c.kind} hides Set to null`).toHaveCount(0)
          await setCreateKind(page, 'Literal', modal)
          await expect(nullBox, 'Literal shows it again').toBeVisible()
          await setCreateKind(page, c.kind, modal)
          await typeCode(page, modal, c.text)
          await expect(nullBox, `${c.kind} with a source still hides Set to null`).toHaveCount(0)
          await create(page, modal, name)
          await expect(badge(page, name, c.badge), `${name} carries its ${c.kind} badge`).toBeVisible()
        })
      }
    }

    await test.step('VMGR-111: the stored items keep their kind and source', async () => {
      const stored = await saveAndRead(page, request, testName, testId)
      for (const window of KIND_WINDOWS) {
        for (const c of cases) {
          expect(storedShape(stored, window.kind, `${window.prefix}_${c.suffix}`)).toEqual({
            type: c.type,
            hasValue: true,
            value: c.text,
            isExpression: c.kind === 'Expression' ? true : undefined,
            isTemplate: c.kind === 'Template' ? true : undefined,
          })
        }
      }
    })
  })

  test('a secret created null shows the null look, not the mask', async ({ page, request }) => {
    test.setTimeout(300_000)
    const testName = uniqueName('set-to-null-secret')
    testId = await seedWithFunction(request, testName)
    await openTest(page, testId)

    const secretName = (window: CreationWindow) => `${window.prefix}_sec`

    for (const window of WINDOWS) {
      await enterScope(page, testName, window.kind)
      await test.step(`VMGR-93 ${window.label}: a secret ticked Set to null`, async () => {
        const name = secretName(window)
        const modal = await openWindow(page, window.kind)
        await setCreateName(page, name, modal)
        await modal.locator('[data-testid="create-secret-checkbox"]').click()
        const nullBox = setToNullCheckbox(page, modal)
        if (window.kind === 'input') {
          // Per VMGR-103: a secret input has no default, so Mark as secret forces Set to null on.
          await expect(nullBox).toBeChecked()
          await expect(nullBox).toHaveAttribute('aria-disabled', 'true')
          await nullBox.click({ force: true })
          await expect(nullBox, 'a click leaves the forced box ticked').toBeChecked()
          await nullBox.focus()
          await page.keyboard.press('Space')
          await expect(nullBox, 'Space leaves the forced box ticked').toBeChecked()
          const field = createNullField(page, modal)
          await expect(field).toHaveValue('null')
          await expect(field).toHaveAttribute('aria-disabled', 'true')
          await expect(field).toHaveAttribute('readonly', '')
        } else {
          await setToNull(page, modal)
          await expectNullLook(createNullField(page, modal), `${name}: the null field`)
        }
        await create(page, modal, name)
        await expect(badge(page, name, 'secret'), `${name} is secret`).toBeVisible()
        await expectNullLook(valueCell(page, name), `the ${name} row`)
        await expect(valueCell(page, name)).not.toHaveText(SECRET_MASK)
      })
    }

    await test.step('REQ-3.1.3.24: each secret is stored null with its secret flag', async () => {
      const stored = await saveAndRead(page, request, testName, testId)
      for (const window of WINDOWS) {
        const shape = storedShape(stored, window.kind, secretName(window))
        expect(shape.secret, `${secretName(window)} keeps its secret flag`).toBe(true)
        expect(shape.value ?? null, `${secretName(window)} holds null`).toBeNull()
        expect(shape.isExpression, `${secretName(window)} has no kind flag`).toBeUndefined()
        expect(shape.isTemplate, `${secretName(window)} has no kind flag`).toBeUndefined()
        if (window.kind !== 'input') expect(shape.hasValue, `${secretName(window)} stores its null`).toBe(true)
      }
    })

    await test.step('VMGR-93: after a reload every secret still reads null, never the mask', async () => {
      await openTest(page, testId)
      for (const window of WINDOWS) {
        await enterScope(page, testName, window.kind)
        const name = secretName(window)
        await expect(badge(page, name, 'secret')).toBeVisible()
        await expectNullLook(valueCell(page, name), `the reloaded ${name} row`)
      }
    })
  })
})
