/**
 * V-CANVAS-FN-CFG-04: Function Block window - inputs and outputs by kind
 * Design Decisions: FNCFG-6, FNCFG-7, FIELD-2 (a held default shows in gray), FIELD-5 (an optional input with no
 *   default that is not set shows italic gray `null`, its null button pressed), FIELD-8
 * REQ: REQ-3.1.1.5 (Function instance parameter configuration), REQ-3.1.3.20 (a value that holds nothing is null),
 *   REQ-3.1.2.9 (secret parameters), REQ-3.1.2.11 (enum inputs)
 *
 * Seeds (API; every Test `zz-` named and deleted, every library Function deleted with cascade):
 * - `POST /tests`: a Local Function whose optional integer input `n_int` is stored with
 *   `default: null`; one with integer `k_int` and float `k_float` stored with `default: null`;
 *   an empty Local Function whose inputs of every free-entry field kind are then created null in the
 *   input window (Set to null, through the UI); a Local Function whose inputs of every field kind hold
 *   a default (its Block holds the true / false default, written when the input appears); and a Local
 *   Function `fetch_token` with a secret input `api_key` holding a literal (stored sealed), an Integer
 *   enum input `retries` (`1`, `2`, `10`, default `1`) holding `2`, a plain input `region`, a secret
 *   output `token`, next to a Log block.
 * - `POST /functions`: a library Function whose inputs of every free-entry field kind are stored with
 *   `default: null`, and one whose inputs of every field kind hold a default; each on a Function Block
 *   of a seeded Test.
 * The thing under test (how the Function Block window draws each field) is read through the UI.
 *
 * Pass Criteria:
 * 1. The stored input keeps `default: null`.
 * 2. The `n_int` row opens as its literal number box holding no text, showing the italic gray `null`
 *    with its null button pressed, never a `null` placeholder; switched to the expression field, the
 *    field is empty with no placeholder.
 * 3. An integer and a float input with a null default open the same way: an empty number box with the
 *    italic gray `null` and the null button pressed.
 * 4. Every free-entry field kind (string, integer, float, array, map, table) of a Local Function
 *    input created null in the window, and of a library Function input with `default: null`,
 *    opens as its literal box holding no text with the italic gray `null` and the null button
 *    pressed, and switches to an empty expression field.
 * 5. Every free-entry field kind with a held default shows the default dimmed, Local and library; the
 *    true / false input shows its default as a value of its own, never dimmed (FIELD-8).
 * 6. A secret input is drawn as a plugin secret field: pencil, masked dots, lock, expression
 *    button; the stored literal never shows.
 * 7. An enum input is the block-config select (the trigger a Log block's Level draws) listing its
 *    allowed values in order, with the required star and the expression button.
 * 8. A secret output row opens with Secret ticked; the user may untick it and the Save keeps it.
 *
 * Phase: no-data (seeds and deletes its own Tests).
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  FIELD_KINDS,
  enumTrigger,
  expectEmptyCodeField,
  expectHeldDefault,
  expectHeldValue,
  exprToggle,
  literalField,
  numberInput,
  openOptions,
  outputRow,
  paramRow,
  requiredStar,
  saveButton,
  type FieldKind,
} from '../../helpers/config-sheet'
import { localFunctionNode, logNode, openTest, publishLibraryFunction, setFunctionFields, sharedNode, startEdge } from '../../helpers/fn-seed'
import {
  openFunctionCreateModal,
  setCreateName,
  setCreateType,
  setToNull,
  submitCreate,
  variableRow,
} from '../../helpers/variable-create'
import { expectTextMuted, nullButton, stateMarker, textLook } from '../../helpers/value-field'
import { configSheet, digIn, openBlockSheet, openFunctionBlockSheet, popToBreadcrumbSegment, saveTest } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-cfg-null-default'
const LIBRARY_NODE_ID = 'fn-cfg-library'
const TOKEN_NODE_ID = 'fn-fetch-token'
const LOG_NODE_ID = 'log-level-probe'

// The literal tooltip of the credential field's lock (SECFLD-1).
const LITERAL_TOOLTIP =
  'This value is stored protected - after saving, it can be replaced, and viewed only ' +
  'while secret unmasking is enabled in Settings.'

interface StoredInput {
  name: string
  default?: unknown
}

/** One optional input per number box, each stored with `default: null`. */
const NUMBER_KINDS = [
  { name: 'k_int', type: 'integer' },
  { name: 'k_float', type: 'float' },
] as const

/** A held default per field kind and how the one value field shows it (FIELD-1). */
const HELD: ReadonlyArray<{ kind: FieldKind; value: unknown; shown: string }> = [
  { kind: 'string', value: 'hello', shown: 'hello' },
  { kind: 'integer', value: 7, shown: '7' },
  { kind: 'float', value: 1.5, shown: '1.5' },
  { kind: 'boolean', value: true, shown: 'true' },
  { kind: 'array', value: [1, 2], shown: '[1, 2]' },
  { kind: 'map', value: { k: 1 }, shown: '{"k": 1}' },
  { kind: 'table', value: [{ id: 1 }], shown: '[{"id": 1}]' },
]

/** The kinds that can be left unset and show a gray default; a true / false input always holds a value (FIELD-8). */
const FREE_KINDS: readonly FieldKind[] = FIELD_KINDS.filter((kind) => kind !== 'boolean')
const FREE_HELD = HELD.filter(({ kind }) => kind !== 'boolean')

const nullName = (kind: FieldKind): string => `n_${kind}`
const heldName = (kind: FieldKind): string => `h_${kind}`

function zzName(): string {
  return `zz-v-canvas-fn-cfg-04-${randomUUID().slice(0, 8)}`
}

async function postTest(
  request: APIRequestContext,
  name: string,
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      version: '1.0.0',
      description: 'V-CANVAS-FN-CFG-04 seed: Function Block windows by field kind',
      workflow: { nodes, edges },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id as string
}

async function seedTest(
  request: APIRequestContext,
  name: string,
  inputs: ReadonlyArray<{ name: string; type: string }> = [{ name: 'n_int', type: 'integer' }],
): Promise<string> {
  return postTest(
    request,
    name,
    [
      localFunctionNode(FN_NODE_ID, 'Function_1', {
        nodes: [],
        inputs: inputs.map((input) => ({ ...input, required: false, default: null })),
      }),
    ],
    [startEdge(FN_NODE_ID)],
  )
}

async function storedInputs(request: APIRequestContext, testId: string): Promise<StoredInput[]> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.workflow.nodes as Array<{
    id: string
    data: { localDefinition?: { inputs?: StoredInput[] } }
  }>
  return nodes.find((n) => n.id === FN_NODE_ID)?.data.localDefinition?.inputs ?? []
}

async function closeSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  // The {x} switches leave the window edited; Close in its question keeps nothing.
  const question = sheet.page().getByRole('dialog', { name: 'Unsaved changes' })
  const asked = await question
    .waitFor({ state: 'visible', timeout: 1_000 })
    .then(() => true)
    .catch(() => false)
  if (asked) await question.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

/** Per FIELD-5: an optional input with no default that is not set shows italic gray `null`, its null button pressed. */
async function expectNullField(sheet: Locator, name: string, kind: FieldKind): Promise<void> {
  await expect(exprToggle(sheet, name), `${name} opens as its literal box`).toHaveAttribute('aria-pressed', 'false')
  const box = literalField(sheet, name, kind)
  await expect(box, `${name}: the box holds no text`).toHaveValue('')
  await expect(box, `${name}: never a null placeholder`).not.toHaveAttribute('placeholder', 'null')
  const marker = stateMarker(sheet, name)
  await expect(marker, `${name}: the null marker`).toHaveText('null')
  expect((await textLook(marker)).fontStyle, `${name}: the null marker is italic`).toBe('italic')
  await expectTextMuted(marker, `${name}: the null marker`)
  await expect(nullButton(sheet, name), `${name}: the null button is pressed`).toHaveAttribute('aria-pressed', 'true')
}

/** Every free-entry kind opens null, and its expression field is empty. */
async function expectEveryKindEmpty(sheet: Locator, nameOf: (kind: FieldKind) => string): Promise<void> {
  for (const kind of FREE_KINDS) await expectNullField(sheet, nameOf(kind), kind)
  for (const kind of FREE_KINDS) {
    await exprToggle(sheet, nameOf(kind)).click()
    await expectEmptyCodeField(sheet, nameOf(kind))
  }
}

/** Create one optional input of `kind` in the input window with Set to null ticked. */
async function createNullInput(page: Page, name: string, kind: FieldKind): Promise<void> {
  const modal = await openFunctionCreateModal(page, 'input')
  await setCreateName(page, name, modal)
  if (kind !== 'string') await setCreateType(page, kind, modal)
  await setToNull(page, modal)
  await submitCreate(page, modal)
  await expect(modal).toBeHidden()
  await expect(variableRow(page, name)).toBeVisible()
}

test.describe('V-CANVAS-FN-CFG-04: Function Block window - inputs and outputs by kind', () => {
  let testId = ''
  let libraryFunctionId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
    if (libraryFunctionId) {
      await request.delete(`${BACKEND_URL}/functions/${libraryFunctionId}?cascade=true`).catch(() => undefined)
    }
    libraryFunctionId = ''
  })

  test('an input with a null default opens as its number box showing null, and its expression field is empty', async ({
    page,
    request,
  }) => {
    testId = await seedTest(request, zzName())
    expect(await storedInputs(request, testId)).toEqual([
      expect.objectContaining({ name: 'n_int', default: null }),
    ])

    await openTest(page, testId)
    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(fnNode).toBeVisible()
    await fnNode.locator(`[data-testid="workflow-node-body-${FN_NODE_ID}"]`).dblclick()
    const sheet = configSheet(page)
    await expect(paramRow(sheet, 'n_int')).toBeVisible({ timeout: 10_000 })

    // Per FIELD-5: an input opens as its literal box, the number box, showing null.
    await expect(numberInput(sheet, 'n_int')).toHaveJSProperty('tagName', 'INPUT')
    await expectNullField(sheet, 'n_int', 'integer')

    await exprToggle(sheet, 'n_int').click()
    await expect(exprToggle(sheet, 'n_int')).toHaveAttribute('aria-pressed', 'true')
    await expectEmptyCodeField(sheet, 'n_int')
  })

  test('an integer or float input with a null default shows an empty number box holding null', async ({
    page,
    request,
  }) => {
    testId = await seedTest(request, zzName(), NUMBER_KINDS)
    expect(await storedInputs(request, testId)).toEqual(
      NUMBER_KINDS.map(({ name }) => expect.objectContaining({ name, default: null })),
    )

    await openTest(page, testId)
    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(fnNode).toBeVisible()
    await fnNode.locator(`[data-testid="workflow-node-body-${FN_NODE_ID}"]`).dblclick()
    const sheet = configSheet(page)
    await expect(paramRow(sheet, NUMBER_KINDS[0].name)).toBeVisible({ timeout: 10_000 })

    for (const { name, type } of NUMBER_KINDS) {
      await expect(numberInput(sheet, name), `${type}: a number box`).toHaveJSProperty('tagName', 'INPUT')
      await expectNullField(sheet, name, type)
    }
  })

  test('every free-entry field kind of a Local Function input created null in the window shows null in its field', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const name = zzName()
    testId = await seedTest(request, name, [])
    await openTest(page, testId)

    await digIn(page, FN_NODE_ID)
    await expect(page.locator('[data-testid="add-variable-dropdown-trigger"]')).toBeVisible()
    for (const kind of FREE_KINDS) await createNullInput(page, nullName(kind), kind)
    await popToBreadcrumbSegment(page, name)
    await saveTest(page)
    const stored = await storedInputs(request, testId)
    for (const kind of FREE_KINDS) {
      const input = stored.find((entry) => entry.name === nullName(kind))
      expect(input, `${kind} input is stored`).toBeTruthy()
      expect(input?.default ?? null, `${kind} input is stored null`).toBeNull()
    }

    const sheet = await openFunctionBlockSheet(page, FN_NODE_ID)
    await expectEveryKindEmpty(sheet, nullName)
    await closeSheet(sheet)
  })

  test('every free-entry field kind of a library Function input with a null default shows null in its field', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    const library = await publishLibraryFunction(request, {
      name: `zz-fn-cfg-04-null-${randomUUID().slice(0, 8)}`,
      inputs: FREE_KINDS.map((kind) => ({ name: nullName(kind), type: kind, required: false, default: null })),
    })
    libraryFunctionId = library.functionId
    testId = await postTest(
      request,
      zzName(),
      [
        sharedNode(LIBRARY_NODE_ID, {
          functionId: library.functionId,
          functionVersion: library.version,
          label: 'Null_Library',
          originalLibraryName: library.name,
        }),
      ],
      [startEdge(LIBRARY_NODE_ID)],
    )
    await openTest(page, testId)

    const sheet = await openFunctionBlockSheet(page, LIBRARY_NODE_ID)
    await expectEveryKindEmpty(sheet, nullName)
    await closeSheet(sheet)
  })

  test('a held default shows dimmed in every free-entry field kind and true / false holds its default, Local and library', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    const inputs = HELD.map(({ kind, value }) => ({ name: heldName(kind), type: kind, required: false, default: value }))
    const library = await publishLibraryFunction(request, {
      name: `zz-fn-cfg-04-held-${randomUUID().slice(0, 8)}`,
      inputs,
    })
    libraryFunctionId = library.functionId
    // A true / false input's default is written on the Block when the input appears (REQ-3.1.2.10).
    const heldBool = { values: { [heldName('boolean')]: true } }
    testId = await postTest(
      request,
      zzName(),
      [
        setFunctionFields(localFunctionNode(FN_NODE_ID, 'Held_Local', { nodes: [], inputs }), heldBool),
        sharedNode(LIBRARY_NODE_ID, {
          functionId: library.functionId,
          functionVersion: library.version,
          label: 'Held_Library',
          originalLibraryName: library.name,
          position: { x: 560, y: 200 },
          ...heldBool,
        }),
      ],
      [startEdge(FN_NODE_ID), { id: 'e-local-library', source: FN_NODE_ID, target: LIBRARY_NODE_ID }],
    )
    await openTest(page, testId)

    for (const [where, nodeId] of [
      ['Local', FN_NODE_ID],
      ['library', LIBRARY_NODE_ID],
    ] as const) {
      await test.step(`${where} Function`, async () => {
        const sheet = await openFunctionBlockSheet(page, nodeId)
        for (const { kind, shown } of FREE_HELD) await expectHeldDefault(page, sheet, heldName(kind), kind, shown)
        await expectHeldValue(page, sheet, heldName('boolean'), 'boolean', 'true')
        await closeSheet(sheet)
      })
    }
  })

  test.describe('the wireframe Function Block window', () => {
    const canary = `sk-canary-${randomUUID()}`

    test.beforeEach(async ({ page, request }) => {
      const tokenNode = localFunctionNode(TOKEN_NODE_ID, 'fetch_token', {
        nodes: [],
        inputs: [
          { name: 'api_key', type: 'string', required: false, secret: true },
          { name: 'retries', type: 'integer', required: true, enumValues: [1, 2, 10], default: 1 },
          { name: 'region', type: 'string', required: false },
        ],
        outputs: [{ name: 'token', type: 'string', secret: true }],
      }) as { data: Record<string, unknown> }
      setFunctionFields(tokenNode, { values: { api_key: canary, retries: 2 } })
      testId = await postTest(
        request,
        zzName(),
        [tokenNode as unknown as Record<string, unknown>, logNode(LOG_NODE_ID, 'Level Probe', "'x'", { x: 560, y: 200 })],
        [startEdge(TOKEN_NODE_ID), { id: 'e-token-log', source: TOKEN_NODE_ID, target: LOG_NODE_ID }],
      )
      await openTest(page, testId)
    })

    test('a secret input is drawn as a plugin secret field', async ({ page }) => {
      const sheet = await openFunctionBlockSheet(page, TOKEN_NODE_ID)
      const row = paramRow(sheet, 'api_key')
      // Per FNCFG-7: pencil, masked dots, lock, expression button.
      const masked = row.getByRole('button', { name: 'Edit protected value', exact: true })
      await expect(masked).toBeVisible()
      await expect(masked.locator('svg.lucide-pencil')).toHaveCount(1)
      await expect(masked).toHaveText('••••••••')
      await expect(row.locator(`[aria-label="${LITERAL_TOOLTIP}"]`), 'the lock of a stored literal').toBeVisible()
      await expect(exprToggle(sheet, 'api_key')).toHaveAttribute('aria-pressed', 'false')
      await expect(sheet.getByText(canary)).toHaveCount(0)
      await expect(sheet.getByText(/wave:enc:v1:/)).toHaveCount(0)
      await closeSheet(sheet)
    })

    test('an enum input is the block-config select of its allowed values with the expression button', async ({
      page,
    }) => {
      const sheet = await openFunctionBlockSheet(page, TOKEN_NODE_ID)
      const trigger = enumTrigger(sheet, 'retries')
      await expect(trigger).toHaveText('2')
      await expect(requiredStar(sheet, 'retries')).toHaveCount(1)
      await expect(exprToggle(sheet, 'retries')).toHaveAttribute('aria-pressed', 'false')
      const listbox = await openOptions(page, sheet, 'retries')
      await expect(listbox.getByRole('option')).toHaveText(['1', '2', '10'])
      await page.keyboard.press('Escape')
      await expect(listbox).toHaveCount(0)
      const fnTriggerClass = await trigger.getAttribute('class')
      await closeSheet(sheet)

      // Per FNCFG-6: the same select a block setting with fixed choices draws.
      const logSheet = await openBlockSheet(page, LOG_NODE_ID)
      await expect(enumTrigger(logSheet, 'level')).toBeVisible()
      expect(await enumTrigger(logSheet, 'level').getAttribute('class'), 'the Log Level select').toBe(fnTriggerClass)
      await closeSheet(logSheet)
    })

    test('a secret output row opens with Secret ticked', async ({ page }) => {
      const sheet = await openFunctionBlockSheet(page, TOKEN_NODE_ID)
      const secret = outputRow(sheet, 'token').locator('[data-testid="output-secret-token"]')
      // Per FNCFG-7: a declared secret output seeds its Secret box ticked.
      await expect(secret).toHaveAttribute('data-state', 'checked')
      await secret.click()
      await expect(secret).toHaveAttribute('data-state', 'unchecked')
      await saveButton(sheet).click()
      await expect(sheet).toBeHidden({ timeout: 10_000 })

      const reopened = await openFunctionBlockSheet(page, TOKEN_NODE_ID)
      await expect(
        outputRow(reopened, 'token').locator('[data-testid="output-secret-token"]'),
        'the user may untick it',
      ).toHaveAttribute('data-state', 'unchecked')
      await closeSheet(reopened)
    })
  })
})
