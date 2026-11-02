/**
 * V-SECRET-PROMOTE-WARNING: the Save warning before a block Save makes plain variables secret
 * Design Decisions: SECUI-3, SECUI-4, SECUI-11, SECUI-12
 * REQ: REQ-4.5.20, REQ-3.1.2.9, REQ-5.2.1.23
 *
 * Phase: functional-workflow (no run). API seed per test (POST /tests): one `zz-` Test holding
 * the carrier Block - HTTP Request, a Local Function, Shell Script, Python or Variable Setter -
 * whose rows are bound to plain variables that hold values, Secret unticked, plus an already
 * secret variable for the negatives and the sticky-secret test. Ticking Secret, typing new
 * names, adding export and Setter rows, the Block Save, the warning and the toolbar Save all run
 * through the UI. The test-variables reveal flag is turned off for the file when it is on and
 * restored afterwards.
 *
 * Pass Criteria:
 * 1. On every carrier (plugin outputs table, Function Block outputs table, Shell Script and
 *    Python export rows, Variable Setter rows) a Block Save that ticks Secret on a row bound to
 *    an existing plain variable opens the warning before anything is saved; a secret Function
 *    output's seeded Secret row counts as ticked.
 * 2. One variable: title "Make this variable secret?", body "Saving makes the plain variable
 *    <name> a secret. Its value is masked from then on. Making it plain again clears its value." with
 *    the name in inline code and no list; the triangle icon; buttons exactly "Cancel" and a red
 *    "Make secret and save".
 * 3. Several: title "Make N variables secret?", body "Saving makes these plain variables secrets.
 *    Their values are masked from then on. Making them plain again clears their values.", every name
 *    in the mono list; twelve Variable Setter names are all listed and the list scrolls.
 * 4. "Make secret and save" closes the sheet; each named variable shows the SECRET badge and a
 *    masked value; the saved Test declares each one secret, reads it masked and exports it
 *    sealed (encrypted export), the Block keeps every Secret row and a Variable Setter row's
 *    literal is sealed.
 * 5. Escape leaves the warning and the sheet open. Cancel returns to the open sheet with every tick
 *    kept and no variable changed; after the sheet is closed unsaved and the Test saved, every
 *    variable is still plain with its value and the Block holds none of the Secret rows.
 * 6. A new variable typed into a Secret row and a variable that is already secret open no warning:
 *    the Save closes the sheet at once, the new variable is created secret and the other stays
 *    secret.
 * 7. The Save offered by the Unsaved changes question asks the same warning, on a plugin sheet and
 *    on a Function Block sheet.
 * 8. A second HTTP Block binding an existing secret variable with Secret unticked, and unticking
 *    Secret on the Block that made it secret, open no warning; after a reload the variable keeps
 *    its SECRET badge and masked value, and the saved Test keeps it secret and sealed.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importFixtureTest } from '../../helpers/fixture-import'
import { localFunctionNode, logNode, openTest, startEdge } from '../../helpers/fn-seed'
import { SECRET_ENVELOPE, SECRET_MASK } from '../../helpers/secret-canary'
import { createSimpleVariable, expandVariableManager, variableRow } from '../../helpers/variable-create'
import {
  confirmSecretPromotion,
  openBlockSheet,
  saveTest,
  secretPromoteDialog,
} from '../../helpers/workbench'

const ONE_TITLE = 'Make this variable secret?'
const oneBody = (name: string): string =>
  `Saving makes the plain variable ${name} a secret. Its value is masked from then on. Making it plain again clears its value.`
const manyTitle = (count: number): string => `Make ${count} variables secret?`
const MANY_BODY =
  'Saving makes these plain variables secrets. Their values are masked from then on. Making them plain again clears their values.'
const CONFIRM = 'Make secret and save'

const ALREADY_SECRET = 'already_secret'
const FRESH = 'fresh_secret'
const PROBE = 'saved_probe'
const NODE_DIMS = { width: 120, height: 62 }

type ValueType = 'string' | 'integer' | 'float' | 'map' | 'array'

/** One carrier row: its own key (output, export or Setter target) and the variable it writes. */
interface Row {
  key: string
  variable: string
  type: ValueType
  /** A Function output declared secret: its binding is picked in the UI and its box seeds ticked. */
  seededSecret?: boolean
}

interface StoredNode {
  id: string
  data: {
    config?: {
      values?: Record<string, unknown>
      outputBindings?: Record<string, string>
      outputSecretFields?: string[]
      variableSecretKeys?: string[]
    }
  }
}

interface StoredTest {
  variables: Record<string, { value?: unknown; type?: string; secret?: boolean }>
  workflow: { nodes: StoredNode[] }
}

interface Carrier {
  id: string
  /** The carrier as the test titles name it. */
  phrase: string
  /** Short name for titles that already name the cell. */
  short: string
  block: string
  one: Row[]
  many: Row[]
  /** The already secret variable's row in the negatives seed. */
  secretRow: Row
  node(rows: Row[]): Record<string, unknown>
  secretBox(sheet: Locator, rows: Row[], row: Row): Locator
  /** Bind a seeded secret row's variable in the sheet. */
  bindInSheet?(page: Page, sheet: Locator, row: Row): Promise<void>
  /** Type a new variable into a free row of the open sheet; returns that row's Secret box. */
  addFreshRow(page: Page, sheet: Locator, name: string): Promise<Locator>
  /** The rows the stored Block marks secret, by row key. */
  storedSecretKeys(node: StoredNode): string[]
  /** The stored literal of a row, where the carrier stores one (Variable Setter). */
  storedLiteral?(node: StoredNode, row: Row): unknown
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

const HTTP_VALUES = {
  url: "f'https://127.0.0.1:9449/echo'",
  method: 'GET',
  timeout: 30,
  retry_count: 0,
  retry_delay: 1,
  retry_backoff_factor: 2,
  retryable_status_codes: ['502', '503', '504'],
  verify_ssl: false,
  allow_redirects: true,
  max_redirects: 10,
}

function bindings(rows: Row[]): Record<string, string> {
  return Object.fromEntries(rows.filter((row) => !row.seededSecret).map((row) => [row.key, row.variable]))
}

function pluginNode(
  id: string,
  label: string,
  elementType: string,
  category: string,
  values: Record<string, unknown>,
  outputBindings: Record<string, string>,
  outputSecretFields?: string[],
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 300, y: 200 },
    data: {
      label,
      elementType,
      nodeType: 'plugin',
      category,
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: elementType === 'http-client' ? ['url'] : [],
      templateFields: [],
      config: {
        values,
        outputBindings,
        ...(outputSecretFields ? { outputSecretFields } : {}),
        profileBindings: [],
      },
    },
    measured: { ...NODE_DIMS },
  }
}

function httpNode(id: string, label: string, rows: Row[], outputSecretFields?: string[]): Record<string, unknown> {
  return pluginNode(id, label, 'http-client', 'network', { ...HTTP_VALUES }, bindings(rows), outputSecretFields)
}

const TYPED_VALUES: Record<ValueType, (variable: string) => unknown> = {
  string: (variable) => `plain-${variable}`,
  integer: () => 7,
  float: () => 2.5,
  map: () => ({ k: 'v' }),
  array: () => ['a', 'b'],
}

const SETTER_LITERALS: Partial<Record<ValueType, (key: string) => unknown>> = {
  string: (key) => `set-${key}`,
  integer: () => 9,
  float: () => 1.5,
}

/** The stored value a plain variable keeps when nothing promoted it. */
const plainValue = (row: Row): unknown => TYPED_VALUES[row.type](row.variable)

function plainVariables(rows: Row[]): Record<string, unknown> {
  return Object.fromEntries(
    rows.map((row) => [row.variable, { value: plainValue(row), type: row.type, scope: 'test' }]),
  )
}

// ---------------------------------------------------------------------------
// Carriers
// ---------------------------------------------------------------------------

const outputBox = (sheet: Locator, key: string): Locator =>
  sheet.locator(`[data-testid="output-secret-${key}"]`)

async function typeIntoCombobox(combobox: Locator, name: string): Promise<void> {
  await combobox.click()
  await combobox.fill(name)
  await combobox.press('Tab')
  await expect(combobox).toHaveValue(name)
}

async function typeIntoOutputRow(sheet: Locator, output: string, name: string): Promise<void> {
  await typeIntoCombobox(sheet.locator(`[data-testid="output-row-${output}"] [role="combobox"]`).first(), name)
}

const outputSecretKeys = (node: StoredNode): string[] => node.data.config?.outputSecretFields ?? []

const HTTP: Carrier = {
  id: 'http',
  phrase: 'an output row (HTTP Request)',
  short: 'HTTP Request output row',
  block: 'http-fetch',
  one: [{ key: 'body', variable: 'h_token', type: 'string' }],
  many: [
    { key: 'body', variable: 'h_body', type: 'string' },
    { key: 'status_code', variable: 'h_code', type: 'integer' },
    { key: 'response_time', variable: 'h_time', type: 'float' },
    { key: 'headers', variable: 'h_headers', type: 'map' },
  ],
  secretRow: { key: 'body', variable: ALREADY_SECRET, type: 'string' },
  node: (rows) => httpNode('http-fetch', 'Fetch Token', rows),
  secretBox: (sheet, _rows, row) => outputBox(sheet, row.key),
  async addFreshRow(_page, sheet, name) {
    await typeIntoOutputRow(sheet, 'content_type', name)
    return outputBox(sheet, 'content_type')
  },
  storedSecretKeys: outputSecretKeys,
}

const FN_FREE_OUTPUT = 'o_new'

const FUNCTION_BLOCK: Carrier = {
  id: 'fn',
  phrase: 'a Function Block output row',
  short: 'Function Block output row',
  block: 'fn-issue',
  one: [{ key: 'o_token', variable: 'f_token', type: 'string' }],
  many: [
    { key: 'o_a', variable: 'f_a', type: 'string', seededSecret: true },
    { key: 'o_b', variable: 'f_b', type: 'integer' },
    { key: 'o_c', variable: 'f_c', type: 'array' },
  ],
  secretRow: { key: 'o_sec', variable: ALREADY_SECRET, type: 'string' },
  node(rows) {
    const outputs = [
      ...rows.map((row) => ({ name: row.key, type: row.type, ...(row.seededSecret ? { secret: true } : {}) })),
      { name: FN_FREE_OUTPUT, type: 'string' },
    ]
    const node = localFunctionNode('fn-issue', 'Issue Token', {
      nodes: [logNode('inner-log', 'Log', "'issued'")],
      edges: [startEdge('inner-log')],
      outputs,
    })
    const data = node.data as Record<string, unknown>
    data.config = { values: {}, outputBindings: bindings(rows), profileBindings: [] }
    return node
  },
  secretBox: (sheet, _rows, row) => outputBox(sheet, row.key),
  bindInSheet: (_page, sheet, row) => typeIntoOutputRow(sheet, row.key, row.variable),
  async addFreshRow(_page, sheet, name) {
    await typeIntoOutputRow(sheet, FN_FREE_OUTPUT, name)
    return outputBox(sheet, FN_FREE_OUTPUT)
  },
  storedSecretKeys: outputSecretKeys,
}

/** Add an export row through the sheet, name it and bind it to `variable`; returns its index. */
async function addExportRow(sheet: Locator, exportName: string, variable: string): Promise<number> {
  const index = await sheet.locator('[data-testid^="output-list-name-"]').count()
  await sheet.getByTestId('output-list-add').click()
  const name = sheet.getByTestId(`output-list-name-${index}`)
  await name.fill(exportName)
  await name.press('Tab')
  await typeIntoCombobox(sheet.getByTestId(`output-list-binding-${index}`).getByRole('combobox'), variable)
  return index
}

function exportCarrier(opts: {
  id: string
  label: string
  elementType: string
  script: string
  freeExport: string
  one: Row[]
  many: Row[]
  secretRow: Row
}): Carrier {
  const block = `${opts.id}-exports`
  return {
    id: opts.id,
    phrase: `an output list row (${opts.label})`,
    short: `${opts.label} export row`,
    block,
    one: opts.one,
    many: opts.many,
    secretRow: opts.secretRow,
    node: (rows) =>
      pluginNode(
        block,
        `${opts.label} Exports`,
        opts.elementType,
        'system',
        { script_type: 'source', script: opts.script, script_variables: rows.map((row) => row.key) },
        bindings(rows),
      ),
    secretBox: (sheet, rows, row) =>
      sheet.locator(`[data-testid="output-list-secret-${rows.indexOf(row)}"]`),
    async addFreshRow(_page, sheet, name) {
      const index = await addExportRow(sheet, opts.freeExport, name)
      return sheet.locator(`[data-testid="output-list-secret-${index}"]`)
    },
    storedSecretKeys: outputSecretKeys,
  }
}

const SHELL = exportCarrier({
  id: 'shell',
  label: 'Shell Script',
  elementType: 'shell-script',
  script: 'TOKEN=t; COUNT=1; LIST=(a b); SEC=s',
  freeExport: 'FRESH',
  one: [{ key: 'TOKEN', variable: 's_token', type: 'string' }],
  many: [
    { key: 'TOKEN', variable: 's_tok', type: 'string' },
    { key: 'COUNT', variable: 's_count', type: 'integer' },
    { key: 'LIST', variable: 's_list', type: 'array' },
  ],
  secretRow: { key: 'SEC', variable: ALREADY_SECRET, type: 'string' },
})

const PYTHON = exportCarrier({
  id: 'python',
  label: 'Python',
  elementType: 'python',
  script: "tok = 't'\ncnt = 1\nconf = {'k': 'v'}\nsec = 's'\n",
  freeExport: 'fresh',
  one: [{ key: 'tok', variable: 'p_token', type: 'string' }],
  many: [
    { key: 'tok', variable: 'p_tok', type: 'string' },
    { key: 'cnt', variable: 'p_count', type: 'integer' },
    { key: 'conf', variable: 'p_conf', type: 'map' },
  ],
  secretRow: { key: 'sec', variable: ALREADY_SECRET, type: 'string' },
})

const SETTER_TYPES: ValueType[] = ['string', 'integer', 'float']

const SETTER: Carrier = {
  id: 'setter',
  phrase: 'a Variable Setter row',
  short: 'Variable Setter row',
  block: 'set-token',
  one: [{ key: 'v_token', variable: 'v_token', type: 'string' }],
  // More names than the 10-name cap of a bulk delete: every one is listed (SECUI-12).
  many: Array.from({ length: 12 }, (_, i) => {
    const name = `v${String(i + 1).padStart(2, '0')}`
    return { key: name, variable: name, type: SETTER_TYPES[i % SETTER_TYPES.length] }
  }),
  secretRow: { key: ALREADY_SECRET, variable: ALREADY_SECRET, type: 'string' },
  node: (rows) => ({
    id: 'set-token',
    type: 'workflowNode',
    position: { x: 300, y: 200 },
    data: {
      label: 'Var Setter',
      elementType: 'variable-setter',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      variableTemplateKeys: [],
      variableTypes: Object.fromEntries(rows.map((row) => [row.key, row.type])),
      config: {
        values: {
          variables: Object.fromEntries(rows.map((row) => [row.key, SETTER_LITERALS[row.type]!(row.key)])),
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { ...NODE_DIMS },
  }),
  secretBox: (sheet, rows, row) =>
    sheet.locator(`[data-testid="varset-secret-checkbox-${rows.indexOf(row)}"]`),
  async addFreshRow(page, sheet, name) {
    const index = await sheet.locator('[data-testid^="varset-name-input-"]').count()
    const add = sheet.getByTestId('varset-add-button')
    await add.click()
    await sheet.getByTestId(`varset-name-input-${index}`).fill(name)
    await add.focus()
    await sheet.getByTestId(`varset-expression-toggle-${index}`).click()
    const editor = sheet.locator(`[data-testid="param-input-${name}"] .cm-content`)
    await editor.click()
    await page.keyboard.insertText("'fresh'")
    // Focus leaves the editor so its suggestion list closes without an Escape that could close the sheet.
    await add.focus()
    await expect(editor).toHaveText("'fresh'")
    return sheet.locator(`[data-testid="varset-secret-checkbox-${index}"]`)
  },
  storedSecretKeys: (node) => node.data.config?.variableSecretKeys ?? [],
  storedLiteral: (node, row) =>
    (node.data.config?.values?.variables as Record<string, unknown> | undefined)?.[row.key],
}

const CARRIERS: Carrier[] = [HTTP, FUNCTION_BLOCK, SHELL, PYTHON, SETTER]

// ---------------------------------------------------------------------------
// Test plumbing
// ---------------------------------------------------------------------------

let testId: string | undefined
let restoreReveal = false

async function seedAndOpen(
  page: Page,
  title: string,
  nodes: Array<Record<string, unknown>>,
  variables: Record<string, unknown>,
): Promise<string> {
  testId = await importFixtureTest(page, {
    name: `zz-V-SECRET-PROMOTE-WARNING ${title}`,
    version: '1.0.0',
    description: 'A carrier Block bound to plain variables, Secret unticked.',
    workflow: {
      nodes,
      edges: [
        startEdge(nodes[0].id as string),
        ...nodes.slice(1).map((node, i) => ({
          id: `e-${i}`,
          source: nodes[i].id as string,
          target: node.id as string,
        })),
      ],
    },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  })
  await openTest(page, testId)
  await expandVariableManager(page)
  return testId
}

const secretVariable = (value: string): Record<string, unknown> => ({
  value,
  type: 'string',
  scope: 'test',
  secret: true,
})

async function readStoredTest(request: APIRequestContext, id: string): Promise<StoredTest> {
  const response = await request.get(`${BACKEND_URL}/tests/${id}`)
  expect(response.ok(), `GET /tests/${id} answered ${response.status()}`).toBeTruthy()
  return ((await response.json()).data ?? {}) as StoredTest
}

/** The saved Test with its secrets as stored at rest (a read masks them). */
async function readSealedTest(request: APIRequestContext, id: string): Promise<StoredTest> {
  const response = await request.get(`${BACKEND_URL}/tests/${id}/export?format=json&secrets=encrypted`)
  expect(response.ok(), `GET /tests/${id}/export answered ${response.status()}`).toBeTruthy()
  return JSON.parse(await response.text()) as StoredTest
}

const SEALED = new RegExp(`^${SECRET_ENVELOPE}`)

function storedNode(stored: StoredTest, id: string): StoredNode {
  const node = stored.workflow.nodes.find((candidate) => candidate.id === id)
  expect(node, `the saved Test keeps Block ${id}`).toBeTruthy()
  return node!
}

const secretBadge = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="secret-badge-"]')

const rowValue = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="variable-value-"]')

const sheetSave = (sheet: Locator): Locator => sheet.getByRole('button', { name: 'Save', exact: true })

/** Tick Secret on every row; a seeded secret row is bound in the sheet and must open ticked. */
async function tickRows(page: Page, sheet: Locator, carrier: Carrier, rows: Row[]): Promise<void> {
  for (const row of rows) {
    const box = carrier.secretBox(sheet, rows, row)
    if (row.seededSecret) {
      await carrier.bindInSheet!(page, sheet, row)
      await expect(box, `the secret output ${row.key} seeds its Secret box ticked`).toHaveAttribute(
        'aria-checked',
        'true',
      )
      continue
    }
    await expect(box, `${row.key} opens with Secret unticked`).toHaveAttribute('aria-checked', 'false')
    await box.click()
    await expect(box).toHaveAttribute('aria-checked', 'true')
  }
}

/** The open warning reads exactly as SECUI-12 for `names`. */
async function expectWarning(page: Page, names: string[]): Promise<void> {
  const dialog = secretPromoteDialog(page)
  await expect(dialog, 'the Save opened the warning').toBeVisible()
  await expect(dialog).toHaveAttribute('role', 'alertdialog')
  await expect(dialog.locator('[data-icon="alert-triangle"]'), 'the warning triangle').toHaveCount(1)
  await expect(dialog.getByRole('button')).toHaveText(['Cancel', CONFIRM])
  await expect(dialog.getByRole('button', { name: CONFIRM, exact: true })).toHaveClass(/btn-danger/)
  const describedBy = await dialog.getAttribute('aria-describedby')
  expect(describedBy, 'the warning names its body').toBeTruthy()
  const body = page.locator(`[id="${describedBy}"]`)
  const list = dialog.locator('[data-item-list]')
  if (names.length === 1) {
    await expect(dialog.getByRole('heading')).toHaveText(ONE_TITLE)
    await expect(body).toHaveText(oneBody(names[0]))
    await expect(body.locator('code'), 'the name is inline code').toHaveText(names[0])
    await expect(list, 'one variable shows no list').toHaveCount(0)
    return
  }
  await expect(dialog.getByRole('heading')).toHaveText(manyTitle(names.length))
  await expect(body).toHaveText(MANY_BODY)
  await expect(list).toHaveClass(/font-mono/)
  const items = list.locator('li')
  await expect(items).toHaveCount(names.length)
  expect((await items.allTextContents()).map((text) => text.trim()).sort()).toEqual([...names].sort())
  if (names.length > 10) {
    // Every name is listed with no cap; a long list scrolls inside its box (SECUI-12).
    await expect
      .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight), {
        message: 'the name list scrolls past the box height',
      })
      .toBe(true)
    await items.last().scrollIntoViewIfNeeded()
    await expect(items.last()).toBeInViewport()
  }
}

test.beforeAll(async ({ request }) => {
  const response = await request.get(`${BACKEND_URL}/admin/secret-masking`)
  const flags = (await response.json().catch(() => ({}))) as { test_variables?: boolean }
  // A stored secret shows masked only while the test-variables reveal is off.
  if (flags.test_variables === true) {
    await request.put(`${BACKEND_URL}/admin/secret-masking`, { data: { test_variables: false } })
    restoreReveal = true
  }
})

test.afterAll(async ({ request }) => {
  if (restoreReveal) {
    await request.put(`${BACKEND_URL}/admin/secret-masking`, { data: { test_variables: true } })
  }
})

test.afterEach(async ({ request }) => {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  testId = undefined
})

// ---------------------------------------------------------------------------
// Matrix 9: carriers x {one, several} x {Confirm, Cancel}, and the negatives
// ---------------------------------------------------------------------------

async function confirmCell(page: Page, carrier: Carrier, rows: Row[], title: string): Promise<void> {
  const id = await seedAndOpen(page, title, [carrier.node(rows)], plainVariables(rows))
  const names = rows.map((row) => row.variable)

  const sheet = await openBlockSheet(page, carrier.block)
  await test.step('tick Secret and Save: the warning names every plain variable', async () => {
    await tickRows(page, sheet, carrier, rows)
    await sheetSave(sheet).click()
    await expectWarning(page, names)
    await expect(sheet, 'nothing is saved while the warning is open').toBeVisible()
  })

  await test.step('Make secret and save: the sheet closes and every variable turns secret', async () => {
    await confirmSecretPromotion(page, names)
    await expect(sheet, 'the confirmed Save closes the sheet').toHaveCount(0)
    for (const name of names) {
      await expect(secretBadge(page, name), `${name} shows the SECRET badge`).toBeVisible()
      await expect(rowValue(page, name), `${name} is masked`).toHaveText(SECRET_MASK)
    }
  })

  await test.step('the saved Test declares each one secret and sealed, and keeps every Secret row', async () => {
    await saveTest(page)
    const stored = await readStoredTest(page.request, id)
    const sealed = await readSealedTest(page.request, id)
    for (const row of rows) {
      expect(stored.variables[row.variable]?.secret, `${row.variable} is stored secret`).toBe(true)
      expect(stored.variables[row.variable]?.value, `${row.variable} reads masked`).toBe(SECRET_MASK)
      expect(String(sealed.variables[row.variable]?.value), `${row.variable} keeps its value sealed`).toMatch(SEALED)
    }
    const node = storedNode(stored, carrier.block)
    expect(carrier.storedSecretKeys(node).sort()).toEqual(rows.map((row) => row.key).sort())
    for (const row of rows) {
      if (!carrier.storedLiteral) break
      const literal = carrier.storedLiteral(storedNode(sealed, carrier.block), row)
      expect(String(literal), `the ${row.key} literal is sealed (SECUI-3)`).toMatch(SEALED)
    }
  })
}

async function cancelCell(page: Page, carrier: Carrier, rows: Row[], title: string): Promise<void> {
  const id = await seedAndOpen(page, title, [carrier.node(rows)], plainVariables(rows))
  const names = rows.map((row) => row.variable)
  const dialog = secretPromoteDialog(page)

  const sheet = await openBlockSheet(page, carrier.block)
  await test.step('tick Secret and Save: the warning opens', async () => {
    await tickRows(page, sheet, carrier, rows)
    await sheetSave(sheet).click()
    await expectWarning(page, names)
  })

  await test.step('Escape does nothing on the warning (REQ-5.2.1.23)', async () => {
    await page.keyboard.press('Escape')
    await expect(dialog, 'Escape leaves the warning open').toBeVisible()
    await expect(sheet, 'Escape leaves the sheet open').toBeVisible()
    await expect(page.getByTestId('unsaved-changes-dialog')).toHaveCount(0)
  })

  await test.step('Cancel returns to the block with every tick kept and no variable changed', async () => {
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(sheet, 'Cancel returns to the block').toBeVisible()
    for (const row of rows) {
      await expect(carrier.secretBox(sheet, rows, row), `${row.key} keeps its tick`).toHaveAttribute(
        'aria-checked',
        'true',
      )
    }
    for (const name of names) {
      await expect(secretBadge(page, name), `${name} stays plain`).toHaveCount(0)
    }
  })

  await test.step('close the sheet unsaved, change something else and save the Test', async () => {
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    const unsaved = page.getByTestId('unsaved-changes-dialog')
    await expect(unsaved).toBeVisible()
    await unsaved.getByTestId('unsaved-close').click()
    await expect(sheet).toHaveCount(0)
    for (const name of names) {
      await expect(secretBadge(page, name), `${name} stays plain`).toHaveCount(0)
      await expect(rowValue(page, name)).not.toHaveText(SECRET_MASK)
    }
    await createSimpleVariable(page, PROBE, { type: 'integer', value: '5' })
    await saveTest(page)
  })

  await test.step('the saved Test keeps every variable plain with its value and no Secret row', async () => {
    const stored = await readStoredTest(page.request, id)
    expect(stored.variables[PROBE], 'the Test was saved after the Cancel').toBeTruthy()
    for (const row of rows) {
      const variable = stored.variables[row.variable]
      expect(variable?.secret ?? false, `${row.variable} is stored plain`).toBe(false)
      expect(variable?.value, `${row.variable} keeps its value`).toEqual(plainValue(row))
    }
    const node = storedNode(stored, carrier.block)
    expect(carrier.storedSecretKeys(node), 'the Block holds none of the Secret rows').toEqual([])
    for (const row of rows) {
      if (!carrier.storedLiteral) break
      expect(carrier.storedLiteral(node, row), `the ${row.key} literal is unchanged`).toEqual(
        SETTER_LITERALS[row.type]!(row.key),
      )
    }
  })
}

async function negativeCell(page: Page, carrier: Carrier, title: string): Promise<void> {
  const rows = [carrier.secretRow]
  const id = await seedAndOpen(page, title, [carrier.node(rows)], {
    [ALREADY_SECRET]: secretVariable(`held-${randomUUID().slice(0, 8)}`),
  })
  await expect(secretBadge(page, ALREADY_SECRET)).toBeVisible()

  const sheet = await openBlockSheet(page, carrier.block)
  await test.step('type a new variable into a free row and tick Secret there and on the secret one', async () => {
    const freshBox = await carrier.addFreshRow(page, sheet, FRESH)
    await freshBox.click()
    await expect(freshBox).toHaveAttribute('aria-checked', 'true')
    const heldBox = carrier.secretBox(sheet, rows, carrier.secretRow)
    await heldBox.click()
    await expect(heldBox).toHaveAttribute('aria-checked', 'true')
  })

  await test.step('Save opens no warning: the sheet closes at once', async () => {
    await sheetSave(sheet).click()
    await expect(sheet, 'a staged Save would keep the sheet open').toHaveCount(0)
    await expect(secretPromoteDialog(page)).toHaveCount(0)
    await expect(secretBadge(page, FRESH), 'the new variable is created secret').toBeVisible()
    await expect(secretBadge(page, ALREADY_SECRET)).toBeVisible()
  })

  await test.step('the saved Test holds both secret and both Secret rows', async () => {
    await saveTest(page)
    const stored = await readStoredTest(page.request, id)
    expect(stored.variables[FRESH]?.secret, 'the new variable is stored secret').toBe(true)
    expect(stored.variables[ALREADY_SECRET]?.secret, 'the secret variable stays secret').toBe(true)
    const sealed = await readSealedTest(page.request, id)
    expect(String(sealed.variables[ALREADY_SECRET]?.value), 'its value stays sealed').toMatch(SEALED)
    const keys = carrier.storedSecretKeys(storedNode(stored, carrier.block))
    expect(keys).toContain(carrier.secretRow.key)
    expect(keys.length, `stored Secret rows: ${keys.join(', ')}`).toBe(2)
  })
}

for (const carrier of CARRIERS) {
  test.describe(`V-SECRET-PROMOTE-WARNING: ${carrier.short}`, () => {
    test(`Save warns before ${carrier.phrase} makes a plain variable secret`, async ({ page }) => {
      test.setTimeout(120_000)
      await confirmCell(page, carrier, carrier.one, `${carrier.id} one confirm`)
    })

    test(`one dialog names every variable that would become secret (${carrier.short})`, async ({ page }) => {
      test.setTimeout(150_000)
      await confirmCell(page, carrier, carrier.many, `${carrier.id} many confirm`)
    })

    test(`Cancel returns to the block unsaved (${carrier.short}, one variable)`, async ({ page }) => {
      test.setTimeout(120_000)
      await cancelCell(page, carrier, carrier.one, `${carrier.id} one cancel`)
    })

    test(`Cancel returns to the block unsaved (${carrier.short}, several variables)`, async ({ page }) => {
      test.setTimeout(150_000)
      await cancelCell(page, carrier, carrier.many, `${carrier.id} many cancel`)
    })

    test(`a new variable or an already secret one shows no dialog (${carrier.short})`, async ({ page }) => {
      test.setTimeout(120_000)
      await negativeCell(page, carrier, `${carrier.id} negatives`)
    })
  })
}

// ---------------------------------------------------------------------------
// The Save of the Unsaved changes question asks the same warning
// ---------------------------------------------------------------------------

test.describe('V-SECRET-PROMOTE-WARNING: the Unsaved changes Save', () => {
  for (const carrier of [HTTP, FUNCTION_BLOCK]) {
    test(`the Unsaved changes Save asks the same question (${carrier.short})`, async ({ page }) => {
      test.setTimeout(120_000)
      const rows = carrier.one
      const id = await seedAndOpen(page, `${carrier.id} unsaved save`, [carrier.node(rows)], plainVariables(rows))
      const names = rows.map((row) => row.variable)
      const sheet = await openBlockSheet(page, carrier.block)
      await tickRows(page, sheet, carrier, rows)

      await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
      const unsaved = page.getByTestId('unsaved-changes-dialog')
      await expect(unsaved).toBeVisible()
      await unsaved.getByTestId('unsaved-save').click()
      await expectWarning(page, names)
      await confirmSecretPromotion(page, names)
      await expect(sheet, 'the confirmed Save closes the sheet').toHaveCount(0)
      await expect(secretBadge(page, names[0])).toBeVisible()

      await saveTest(page)
      const stored = await readStoredTest(page.request, id)
      expect(stored.variables[names[0]]?.secret, `${names[0]} is stored secret`).toBe(true)
      expect(carrier.storedSecretKeys(storedNode(stored, carrier.block))).toEqual([rows[0].key])
    })
  }
})

// ---------------------------------------------------------------------------
// Secret is sticky (SECUI-4): a second binding with Secret off never opens the warning
// ---------------------------------------------------------------------------

test.describe('V-SECRET-PROMOTE-WARNING: secret stays secret', () => {
  test('a second block binding a secret variable with Secret unticked keeps it secret with no dialog', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const token = `sticky-${randomUUID().slice(0, 8)}`
    const bound: Row = { key: 'body', variable: 'api_tok', type: 'string' }
    const id = await seedAndOpen(
      page,
      'sticky secret',
      [httpNode('http-first', 'First Fetch', [bound], ['body']), httpNode('http-second', 'Second Fetch', [])],
      { api_tok: secretVariable(token) },
    )
    await expect(secretBadge(page, 'api_tok')).toBeVisible()

    await test.step('the second block binds the secret variable with Secret unticked: no warning', async () => {
      const sheet = await openBlockSheet(page, 'http-second')
      await typeIntoOutputRow(sheet, 'body', 'api_tok')
      await expect(outputBox(sheet, 'body')).toHaveAttribute('aria-checked', 'false')
      await sheetSave(sheet).click()
      await expect(sheet, 'the Save closes the sheet at once').toHaveCount(0)
      await expect(secretPromoteDialog(page)).toHaveCount(0)
    })

    await test.step('unticking Secret on the first block opens no warning either', async () => {
      const sheet = await openBlockSheet(page, 'http-first')
      const box = outputBox(sheet, 'body')
      await expect(box).toHaveAttribute('aria-checked', 'true')
      await box.click()
      await expect(box).toHaveAttribute('aria-checked', 'false')
      await sheetSave(sheet).click()
      await expect(sheet, 'the Save closes the sheet at once').toHaveCount(0)
      await expect(secretPromoteDialog(page)).toHaveCount(0)
      await expect(secretBadge(page, 'api_tok'), 'the variable stays secret').toBeVisible()
    })

    await test.step('after a reload the variable keeps its SECRET badge and masked value', async () => {
      await saveTest(page)
      await openTest(page, id)
      await expandVariableManager(page)
      await expect(secretBadge(page, 'api_tok')).toBeVisible()
      await expect(rowValue(page, 'api_tok')).toHaveText(SECRET_MASK)
    })

    await test.step('the saved Test keeps it secret and sealed, bound twice with no Secret row', async () => {
      const stored = await readStoredTest(page.request, id)
      expect(stored.variables.api_tok?.secret).toBe(true)
      expect(stored.variables.api_tok?.value, 'a read masks it').toBe(SECRET_MASK)
      const value = String((await readSealedTest(page.request, id)).variables.api_tok?.value)
      expect(value, 'the value stays sealed').toMatch(SEALED)
      expect(value).not.toContain(token)
      for (const block of ['http-first', 'http-second']) {
        const config = storedNode(stored, block).data.config
        expect(config?.outputBindings?.body, `${block} writes api_tok`).toBe('api_tok')
        expect(config?.outputSecretFields ?? [], `${block} holds no Secret row`).not.toContain('body')
      }
    })
  })
})
