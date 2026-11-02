/**
 * V-FN-SECRET-INPUT: a secret input parameter acts as a block's secret field
 * Design Decisions: VMGR-103, VMGR-104, FNCFG-7, SECUI-10, SECFLD-1..4
 * REQ: REQ-3.1.2.9, REQ-3.1.2.10, REQ-3.1.3.5, REQ-3.1.3.18, REQ-4.5.1
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test):
 * - POST /tests: a blank `zz-` Test holding one empty Local Function (window tests), or a Local
 *   Function declaring the secret input `tok` with a body Log reading it (the shape the window
 *   test proves the window stores), or a Shared instance of a library Function.
 * - POST /functions (`publishLibraryFunction`): the library Function with the same input and body,
 *   deleted with cascade=true.
 * - Test variables `plain_tok` (plain) and `sec_tok` (secret), declared in the seed.
 * The input window, every Function Block binding and every run go through the UI. The recipe
 * check goes through MCP (`validate_recipe`, `create_test_from_recipe`); MCP settings are reset
 * in afterAll.
 *
 * Pass Criteria:
 * 1. Mark as secret on a new input replaces the default with a read-only `null` field, ticks Set
 *    to null and locks it (aria-disabled; a click or Space leaves it ticked), and the row shows
 *    the VMGR-103 secret text, also with Required ticked (VMGR-103). The input is stored secret with
 *    no default, and the text typed before the tick is stored nowhere.
 * 2. Mark as secret and Create enum exclude each other, each with its inline hint (VMGR-104).
 * 3. On the Function Block (Local and Library) the input row is a credential field: a literal
 *    typed there is stored sealed (the store holds an envelope, never the value; a read returns
 *    the envelope, as for a Block password), the row reopens masked, and the run gets the real value while the console shows
 *    the mask.
 * 4. A plain variable bound to the input is masked inside the Function on the console Log, the
 *    input's Variable Manager row while drilled, the session read and the run report; the
 *    variable itself stays plain (stored without `secret`, no SECRET badge).
 * 5. A secret variable bound to the input stays masked everywhere the run writes.
 * 6. A recipe giving a secret input a default is refused with `Secret input '<input>' cannot have a default`; without it the recipe
 *    stores the input secret with no default.
 */

import path from 'path'
import { randomUUID } from 'node:crypto'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, STORAGE_BASE_PATH, ensureEnvironment } from '../../helpers/config'
import { paramRow, setRowExpression } from '../../helpers/config-sheet'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
} from '../../helpers/fn-seed'
import { fetchSessionReport } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries, type LogEntry } from '../../helpers/log-reader'
import { callTool, enableMcpUntilRestart, MCP_DEFAULTS } from '../../helpers/mcp'
import { setStringParam } from '../../helpers/param-config'
import { dirBytes, SECRET_ENVELOPE, SECRET_MASK, sweepStore } from '../../helpers/secret-canary'
import {
  expandVariableManager,
  openFunctionCreateModal,
  setCreateName,
  setCreateType,
  submitCreate,
  typeStringValue,
  valueEditor,
  variableRow,
} from '../../helpers/variable-create'
import {
  digIn,
  openBlockSheet,
  popToBreadcrumbSegment,
  runToEnd,
  saveBlockSheet,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'

const FN = 'fn-1'
const BODY_LOG = 'fn-log'
const MCP_PORT = Number(BACKEND_PORT) + 765

/** The input the window stores for Name `tok` + Mark as secret; the run seeds reuse it. */
const SECRET_INPUT = { name: 'tok', type: 'string', secret: true }
/** The body Log: the mask where the value goes, its real last 12 characters after. */
const BODY_MESSAGE = "'in=' + tok + ' tail=' + tok[-12:]"

// Per VMGR-103: the secret text, also when Required is ticked.
const SECRET_REASON = 'A secret input has no default: the Function Block gives the value.'
// Per SECFLD-1..4: the credential field's status icon labels.
const LITERAL_STATUS =
  'This value is stored protected - after saving, it can be replaced, and viewed only while secret unmasking is enabled in Settings.'
const SECRET_VARIABLE_STATUS = 'Value protected - references a secret variable.'
const plainVariableStatus = (name: string): string =>
  `Variable ${name} is not a secret - its value is stored and displayed unprotected. Mark it secret in the Variable Manager to protect it.`

/** The body Log line for a value: masked where printed whole, its real tail after. */
const maskedLine = (value: string): string => `in=${SECRET_MASK} tail=${value.slice(-12)}`

interface StoredNode {
  id: string
  data: {
    config?: { values?: Record<string, unknown> }
    expressionFields?: string[]
    localDefinition?: { inputs?: Array<Record<string, unknown>> }
  }
}

/** The stored field `tok` of the Function Block: its value and whether it is an expression. */
function tokField(node: StoredNode): { value: unknown; expression: boolean } {
  return { value: node.data.config?.values?.tok, expression: (node.data.expressionFields ?? []).includes('tok') }
}

interface StoredTest {
  workflow: { nodes: StoredNode[] }
  variables: Record<string, Record<string, unknown>>
}

async function storedTest(request: APIRequestContext, testId: string): Promise<StoredTest> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const data = (await resp.json()).data
  return { workflow: data.workflow, variables: data.variables ?? {} }
}

function storedNode(test: StoredTest, id: string): StoredNode {
  const node = test.workflow.nodes.find((entry) => entry.id === id)
  expect(node, `the stored Test keeps the Function Block ${id}`).toBeTruthy()
  return node as StoredNode
}

function storedInput(test: StoredTest, name: string): Record<string, unknown> {
  const inputs = storedNode(test, FN).data.localDefinition?.inputs ?? []
  const input = inputs.find((entry) => entry.name === name)
  expect(input, `the stored Function keeps its input ${name}`).toBeTruthy()
  return input as Record<string, unknown>
}

/** The input row's status icon, found by its tooltip text (the icon's accessible name). */
const statusIcon = (row: Locator, label: string): Locator => row.locator(`[aria-label="${label}"]`)

/** The italic hint beside a locked window checkbox. */
const hintOf = (box: Locator): Locator => box.locator('xpath=following-sibling::span')

/** No console line holds the value anywhere. */
function expectNotOnConsole(entries: readonly LogEntry[], value: string, what: string): void {
  const leaked = entries.filter((entry) => entry.message.includes(value))
  expect(leaked, `${what} leaked onto the console.\n${formatEntries(entries)}`).toEqual([])
}

type Variant = 'Local' | 'Library'

interface Seeded {
  testId: string
  testName: string
}

test.describe('V-FN-SECRET-INPUT: secret input parameters', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of testIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    }
    for (const id of functionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/functions/${id}?cascade=true`).catch(() => undefined)
    }
  })

  test.afterAll(async ({ request }) => {
    await request.put(`${BACKEND_URL}/mcp/settings`, { data: MCP_DEFAULTS }).catch(() => undefined)
  })

  /** A Test whose Function Block calls a Function declaring the secret input `tok`. */
  async function seedCallingTest(
    request: APIRequestContext,
    variant: Variant,
    variables: Record<string, unknown> = {},
  ): Promise<Seeded> {
    const tag = randomUUID().slice(0, 8)
    const testName = `zz-fn-secret-input-${variant.toLowerCase()}-${tag}`
    const body = {
      nodes: [logNode(BODY_LOG, 'Log', BODY_MESSAGE)],
      edges: [startEdge(BODY_LOG)],
    }
    let node: Record<string, unknown>
    if (variant === 'Local') {
      node = localFunctionNode(FN, 'Function_1', { ...body, inputs: [SECRET_INPUT] })
    } else {
      const fn = await publishLibraryFunction(request, {
        name: `zz-sec-in-${tag}`,
        inputs: [SECRET_INPUT],
        workflow: body,
      })
      functionIds.push(fn.functionId)
      node = sharedNode(FN, {
        functionId: fn.functionId,
        functionVersion: fn.version,
        label: fn.name,
        originalLibraryName: fn.name,
      })
    }
    const testId = await createValidTest(request, {
      name: testName,
      nodes: [node],
      edges: [startEdge(FN)],
      variables,
    })
    testIds.push(testId)
    return { testId, testName }
  }

  /** Run the Test from the toolbar; it must pass. */
  async function runPassed(page: Page): Promise<LogEntry[]> {
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
    return entries
  }

  test('a secret input has no default: the window disables it and forces Set to null', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const stale = `stale-${randomUUID()}`
    const testId = await createValidTest(request, {
      name: `zz-fn-secret-input-window-${randomUUID().slice(0, 8)}`,
      nodes: [localFunctionNode(FN, 'Function_1', { nodes: [] })],
      edges: [startEdge(FN)],
    })
    testIds.push(testId)
    await openTest(page, testId)
    await digIn(page, FN)

    const modal = await openFunctionCreateModal(page, 'input')
    const nullBox = modal.locator('[data-testid="create-set-to-null-checkbox"]')
    const nullLabel = modal.getByText('Set to null', { exact: true })
    const tooltip = page.getByRole('tooltip')

    await test.step('before the tick the default takes text and Set to null is free', async () => {
      // The window hands focus to Name once it opens; typing before that loses keys to Name.
      await expect(modal.locator('[data-testid="create-variable-name"]')).toBeFocused()
      await setCreateName(page, 'tok')
      await typeStringValue(page, stale)
      await expect(valueEditor(page)).toHaveValue(stale)
      await expect(nullBox).toHaveAttribute('data-state', 'unchecked')
      await expect(nullBox).not.toHaveAttribute('aria-disabled', 'true')
    })

    // Per VMGR-103: Mark as secret disables the default and forces Set to null.
    await test.step('Mark as secret replaces the default with a locked null field', async () => {
      await modal.locator('[data-testid="create-secret-checkbox"]').click()
      await expect(
        modal.locator('[data-testid="window-value-field"] input:not([data-testid="create-null-field"])'),
        'no default field while secret',
      ).toHaveCount(0)
      const nullField = modal.locator('[data-testid="create-null-field"]')
      await expect(nullField).toHaveValue('null')
      await expect(nullField).toHaveAttribute('aria-disabled', 'true')
      await expect(nullField).toHaveAttribute('readonly', '')
    })

    await test.step('Set to null is ticked and stays ticked on click, label click and Space', async () => {
      await expect(nullBox).toHaveAttribute('data-state', 'checked')
      await expect(nullBox).toHaveAttribute('aria-disabled', 'true')
      await nullBox.click({ force: true })
      await expect(nullBox, 'a click leaves it ticked').toHaveAttribute('data-state', 'checked')
      await nullLabel.click({ force: true })
      await expect(nullBox, 'a label click leaves it ticked').toHaveAttribute('data-state', 'checked')
      await nullBox.focus()
      await page.keyboard.press('Space')
      await expect(nullBox, 'Space leaves it ticked').toHaveAttribute('data-state', 'checked')
    })

    await test.step('the row says why, also with Required ticked', async () => {
      await expect(nullBox).toHaveAttribute('aria-description', SECRET_REASON)
      await nullLabel.hover()
      await expect(tooltip).toHaveText(SECRET_REASON)
      const required = modal.locator('[data-testid="param-required-checkbox"]')
      await required.click()
      await expect(required).toHaveAttribute('data-state', 'checked')
      // Per VMGR-103: Required and secret together show the secret text.
      await expect(nullBox).toHaveAttribute('aria-description', SECRET_REASON)
      await nullLabel.hover()
      await expect(tooltip).toHaveText(SECRET_REASON)
      await required.click()
      await expect(required).toHaveAttribute('data-state', 'unchecked')
      await expect(nullBox, 'still forced by secret alone').toHaveAttribute('data-state', 'checked')
    })

    await test.step('Create and Save store the input secret with no default', async () => {
      await submitCreate(page)
      await expect(modal).toBeHidden()
      await expect(
        variableRow(page, 'tok').locator('[data-testid^="secret-badge-"]'),
        'the input row carries the SECRET badge',
      ).toHaveCount(1)
      await saveTest(page)
      const input = storedInput(await storedTest(request, testId), 'tok')
      expect(input, 'the stored input is the seed shape').toMatchObject(SECRET_INPUT)
      expect(input.default ?? null, 'a secret input stores no default').toBeNull()
      expect(sweepStore(stale), 'store files holding the text typed before the tick').toEqual([])
    })
  })

  test('Mark as secret and Create enum exclude each other in the input window', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const testId = await createValidTest(request, {
      name: `zz-fn-secret-input-enum-${randomUUID().slice(0, 8)}`,
      nodes: [localFunctionNode(FN, 'Function_1', { nodes: [] })],
      edges: [startEdge(FN)],
    })
    testIds.push(testId)
    await openTest(page, testId)
    await digIn(page, FN)

    const modal = await openFunctionCreateModal(page, 'input')
    await setCreateName(page, 'level')
    const enumBox = modal.locator('[data-testid="param-create-enum-checkbox"]')
    const secretBox = modal.locator('[data-testid="create-secret-checkbox"]')

    // Per VMGR-104: ticking one disables the other with an inline hint.
    await test.step('Create enum turns Mark as secret off', async () => {
      await enumBox.click()
      await expect(enumBox).toHaveAttribute('data-state', 'checked')
      await expect(secretBox).toHaveAttribute('aria-disabled', 'true')
      await expect(hintOf(secretBox)).toHaveText('off while enum is set')
      await enumBox.click()
      await expect(enumBox).toHaveAttribute('data-state', 'unchecked')
      await expect(secretBox).not.toHaveAttribute('aria-disabled', 'true')
      await expect(modal.getByText('off while enum is set')).toHaveCount(0)
      // Per VMGR-104: Required is locked on only while Create enum is on; this input is not Required.
      const required = modal.locator('[data-testid="param-required-checkbox"]')
      await expect(required).not.toHaveAttribute('aria-disabled', 'true')
      await required.click()
      await expect(required).toHaveAttribute('data-state', 'unchecked')
    })

    await test.step('Mark as secret turns Create enum off', async () => {
      await secretBox.click()
      await expect(secretBox).toHaveAttribute('data-state', 'checked')
      await expect(enumBox).toHaveAttribute('aria-disabled', 'true')
      await expect(hintOf(enumBox)).toHaveText('off while secret is set')
    })

    await test.step('the input is stored secret and never an enum', async () => {
      await submitCreate(page)
      await expect(modal).toBeHidden()
      await saveTest(page)
      const input = storedInput(await storedTest(request, testId), 'level')
      expect(input).toMatchObject({ name: 'level', type: 'string', secret: true })
      expect(input.enumValues, 'no allowed values').toBeUndefined()
    })
  })

  for (const variant of ['Local', 'Library'] as const) {
    test(`a literal typed at the Function Block is sealed at rest and shown masked (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await ensureEnvironment(request)
      const canary = `secin-lit-${randomUUID()}`
      const { testId } = await seedCallingTest(request, variant)
      await openTest(page, testId)

      // Per FNCFG-7: the input row is drawn as a block's credential field.
      await test.step('the input row is a credential field', async () => {
        const sheet = await openBlockSheet(page, FN)
        const row = paramRow(sheet, 'tok')
        await expect(statusIcon(row, LITERAL_STATUS)).toHaveCount(1)
        await expect(row.locator('[data-testid="expression-toggle"]')).toHaveAttribute(
          'aria-pressed',
          'false',
        )
        await setStringParam(sheet, page, 'tok', canary)
        await saveBlockSheet(sheet)
        await saveTest(page)
      })

      // Per SECUI-10: a literal typed on the Function Block is sealed like a credential literal.
      await test.step('the literal is stored sealed and read back sealed', async () => {
        expect(sweepStore(canary), 'store files holding the typed literal').toEqual([])
        expect(
          dirBytes(path.join(STORAGE_BASE_PATH, 'api_tests', testId)).includes(SECRET_ENVELOPE),
          'the stored Test carries the sealed envelope',
        ).toBe(true)
        // Per REQ-3.1.2.9: a secret input is a credential field, so a read returns it sealed like a Block password.
        const stored = tokField(storedNode(await storedTest(request, testId), FN))
        expect(stored.expression, 'the literal is no expression').toBe(false)
        expect(String(stored.value).startsWith(SECRET_ENVELOPE), 'GET /tests returns the literal sealed').toBe(true)
        expect(String(stored.value)).not.toContain(canary)
      })

      await test.step('the row reopens masked, never showing the literal', async () => {
        const sheet = await openBlockSheet(page, FN)
        const row = paramRow(sheet, 'tok')
        await expect(row.getByRole('button', { name: /Edit protected value$/ })).toBeVisible()
        await expect(row).not.toContainText(canary)
        await page.keyboard.press('Escape')
        await expect(sheet).toHaveCount(0)
      })

      await test.step('the run gets the real value and the console shows the mask', async () => {
        const entries = await runPassed(page)
        expectConsoleLine(entries, 'INFO', maskedLine(canary))
        expectNotOnConsole(entries, canary, 'the literal')
      })
    })

    test(`a plain variable bound to a secret input is masked inside the Function and stays plain (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000)
      await ensureEnvironment(request)
      const canary = `secin-plain-${randomUUID()}`
      const { testId, testName } = await seedCallingTest(request, variant, {
        plain_tok: { type: 'string', value: canary, scope: 'test' },
      })
      await openTest(page, testId)

      await test.step('the Function Block binds tok to the plain variable', async () => {
        const sheet = await openBlockSheet(page, FN)
        await setRowExpression(page, sheet, 'tok', 'plain_tok')
        await expect(statusIcon(paramRow(sheet, 'tok'), plainVariableStatus('plain_tok'))).toHaveCount(1)
        await saveBlockSheet(sheet)
        await saveTest(page)
        const stored = await storedTest(request, testId)
        expect(tokField(storedNode(stored, FN))).toEqual({ value: 'plain_tok', expression: true })
      })

      // Per SECUI-10: whatever the Function Block passes in is masked inside the Function.
      await test.step('the console Log masks it while the body reads the real value', async () => {
        const entries = await runPassed(page)
        expectConsoleLine(entries, 'INFO', maskedLine(canary))
        expectNotOnConsole(entries, canary, 'the plain variable bound to tok')
      })

      await test.step('the session read holds no copy of the value', async () => {
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(variables.plain_tok, 'the session read lists the Test variable').toBeTruthy()
        expect(JSON.stringify(variables), 'the session read').not.toContain(canary)
      })

      await test.step('the run report masks it', async () => {
        const report = await fetchSessionReport(page)
        expect(report, 'the report carries the masked body line').toContain(maskedLine(canary))
        expect(report, 'the report').not.toContain(canary)
      })

      await test.step('the input row is masked while drilled into the Function', async () => {
        await digIn(page, FN)
        await expandVariableManager(page)
        const value = variableRow(page, 'tok').locator('[data-testid^="variable-value-"]')
        await expect(value).toHaveText(SECRET_MASK)
        await expect(variableRow(page, 'tok')).not.toContainText(canary)
        await popToBreadcrumbSegment(page, testName)
      })

      // Per SECUI-10: the variable passed in is never promoted.
      await test.step('the plain variable stays plain', async () => {
        await expandVariableManager(page)
        const row = variableRow(page, 'plain_tok')
        await expect(row).toBeVisible()
        await expect(row.locator('[data-testid^="secret-badge-"]')).toHaveCount(0)
        await expect(row.locator('[data-testid^="expand-button-"]')).not.toHaveAttribute(
          'aria-disabled',
          'true',
        )
        const stored = (await storedTest(request, testId)).variables.plain_tok
        expect(stored?.secret ?? false, 'plain_tok is stored without secret').toBe(false)
        expect(stored?.value, 'plain_tok keeps its plain stored value').toBe(canary)
      })
    })

    test(`a secret variable bound to a secret input stays masked (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await ensureEnvironment(request)
      const canary = `secin-sec-${randomUUID()}`
      const { testId } = await seedCallingTest(request, variant, {
        sec_tok: { type: 'string', value: canary, scope: 'test', secret: true },
      })
      await openTest(page, testId)

      await test.step('the Function Block binds tok to the secret variable', async () => {
        const sheet = await openBlockSheet(page, FN)
        await setRowExpression(page, sheet, 'tok', 'sec_tok')
        await expect(statusIcon(paramRow(sheet, 'tok'), SECRET_VARIABLE_STATUS)).toHaveCount(1)
        await saveBlockSheet(sheet)
        await saveTest(page)
        expect(tokField(storedNode(await storedTest(request, testId), FN))).toEqual({ value: 'sec_tok', expression: true })
      })

      await test.step('the run masks it on the console, the session read and the report', async () => {
        const entries = await runPassed(page)
        expectConsoleLine(entries, 'INFO', maskedLine(canary))
        expectNotOnConsole(entries, canary, 'the secret variable bound to tok')
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(variables.sec_tok?.value, 'the session read of sec_tok').toBe(SECRET_MASK)
        expect(JSON.stringify(variables), 'the session read').not.toContain(canary)
        const report = await fetchSessionReport(page)
        expect(report, 'the report').not.toContain(canary)
      })

      await test.step('the secret variable keeps its mask and badge', async () => {
        await expandVariableManager(page)
        const row = variableRow(page, 'sec_tok')
        await expect(row.locator('[data-testid^="secret-badge-"]')).toHaveCount(1)
        await expect(row.locator('[data-testid^="variable-value-"]')).toHaveText(SECRET_MASK)
        expect(sweepStore(canary), 'store files holding the secret variable value').toEqual([])
      })
    })
  }

  test('a recipe refuses a default on a secret input', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
    const tag = randomUUID().slice(0, 8)
    const recipe = (name: string, input: string): string => `test:
  name: ${name}
  description: A secret input takes no default
variables:
  token: {type: string, secret: true, value: "recipe-${tag}"}
functions:
  - name: secret_in
    inputs: [${input}]
    flow:
      - block: log
        settings: {message: {expr: "'in=' + tok"}}
flow:
  - function: secret_in
    settings: {tok: {expr: "token"}}
`
    const refusedName = `zz-fn-secret-input-recipe-refused-${tag}`
    const refused = recipe(refusedName, '{name: tok, type: string, secret: true, default: preset}')
    // The exact SECRET_INPUT_DEFAULT finding.
    const m17 = {
      step: 'functions[secret_in].inputs.tok',
      code: 'SECRET_INPUT_DEFAULT',
      severity: 'error',
      problem: "Secret input 'tok' cannot have a default",
      fix: 'Remove the default; the Function Block gives the value',
    }

    await test.step('validate_recipe refuses the default', () => {
      const result = callTool(MCP_PORT, 'validate_recipe', { recipe: refused })
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload.valid).toBe(false)
      expect(result.payload.findings).toContainEqual(m17)
    })

    await test.step('create_test_from_recipe refuses it and stores nothing', async () => {
      const result = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: refused })
      expect(result.payload.created, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload.findings).toContainEqual(m17)
      const list = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(refusedName)}`)
      expect((await list.json()).data ?? [], 'no Test was stored').toHaveLength(0)
    })

    await test.step('without the default the recipe stores the input secret with no default', async () => {
      const result = callTool(MCP_PORT, 'create_test_from_recipe', {
        recipe: recipe(`zz-fn-secret-input-recipe-${tag}`, '{name: tok, type: string, secret: true}'),
      })
      expect(result.payload.created, JSON.stringify(result.payload)).toBe(true)
      const testId = result.payload.test_id as string
      testIds.push(testId)
      const stored = await storedTest(request, testId)
      const fn = stored.workflow.nodes.find((node) => node.data.localDefinition)
      const input = (fn?.data.localDefinition?.inputs ?? []).find((entry) => entry.name === 'tok')
      expect(input, 'the recipe Function declares tok').toMatchObject(SECRET_INPUT)
      expect(input?.default ?? null, 'no default stored').toBeNull()
    })
  })
})
