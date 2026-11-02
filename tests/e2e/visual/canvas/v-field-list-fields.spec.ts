/**
 * V-FIELD-LIST-FIELDS: list settings drawn as one-line list fields
 * Design Decisions: FIELD-10, FIELD-6, FIELD-2, FIELD-1, HTTP-13
 * REQ: REQ-3.1.1.5, REQ-3.4.2.2, REQ-3.3.2.2
 *
 * Phase: no-data. Each test seeds its own `zz-11541-s2-` Test (POST /tests, zero validation errors) holding an
 * OpenSearch Search Block (Fields set), an OpenSearch Aggregate Block (Stats set), a Python Block (Arguments with
 * one {x} item reading `run_id`) and an HTTP Request Block (multipart Parts set, Cipher Suites not set), and
 * deletes it afterwards. One test per theme: the dark project's theme, then the light theme through the shell
 * toggle.
 *
 * Pass Criteria (each in both themes):
 * 1. Fields shows `["@timestamp", "message"]` in the list color, with the reset icon, the expand and `{ }`.
 * 2. Stats shows `[{"stat": "count"}, {"stat": "sum", "field": "bytes"}]` (one space after each `,` and `:`) in
 *    the list color, cut with "…" at the field's end.
 * 3. Python Arguments shows `["alpha", {{ run_id }}]`: `{{ run_id }}` unquoted in the expression color, the rest
 *    in the list color; the row has the expand and no `{ }` column.
 * 4. HTTP Parts shows `[{"kind": "text", "name": "title", "value": ...` in the list color, cut with "…".
 * 5. `Verify Server Certificate` reads in full on two lines, its checkbox ticked, no expand, with `{ }`.
 * 6. Cipher Suites, not set, shows the gray default (Text Muted) cut with "…": the HTTP Request list of the
 *    TLS capabilities for TLS 1.2 to 1.3, which is every suite of the catalog in catalog order
 *    (`["ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-...`); no reset icon.
 * 7. Every line is the stored value of its Block as GET /tests/{id} returns it, and Cipher Suites is not stored.
 * 8. A screenshot of each window is attached per theme.
 */

import { test, expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { HTTP_MAIN_PORT, HTTP_TARGET_HOST, OPENSEARCH_PORT, OPENSEARCH_TARGET_HOST } from '../../helpers/config'
import { checkbox, elementColor, resolvedColor } from '../../helpers/config-sheet'
import { createValidTest, openTest, validateTest } from '../../helpers/fn-seed'
import {
  closeUnchangedSheet,
  deleteSeededTest,
  expectCut,
  fieldBox,
  fieldExpand,
  fieldLabel,
  fieldReset,
  fieldToggle,
  lineCount,
  lineSegments,
  oneLine,
  openGroup,
  storedBlock,
  tlsCapabilities,
} from '../../helpers/list-fields'
import { toggleTheme } from '../../helpers/theme'
import { openBlockSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

type Theme = 'dark' | 'light'

const LIST_COLOR = 'var(--color-amber-300)'
const EXPRESSION_COLOR = 'var(--color-cyan-400)'
const TEXT_MUTED = 'var(--color-text-muted)'

const NODES = { search: 'os-fields', aggregate: 'os-stats', python: 'py-arguments', http: 'http-parts' } as const

const FIELDS = ['@timestamp', 'message']
const STATS = [{ stat: 'count' }, { stat: 'sum', field: 'bytes' }]
const PARTS = [
  { kind: 'text', name: 'title', value: 'Release notes for the spring build' },
  { kind: 'text', name: 'owner', value: 'qa-team' },
]

const FIELDS_LINE = '["@timestamp", "message"]'
const STATS_LINE = '[{"stat": "count"}, {"stat": "sum", "field": "bytes"}]'
const ARGUMENTS_LINE = '["alpha", {{ run_id }}]'
const PARTS_HEAD = '[{"kind": "text", "name": "title", "value": "Release notes'

const rows = (items: unknown[]): Array<{ value: unknown }> => items.map((value) => ({ value }))

function block(
  id: string,
  x: number,
  data: { label: string; elementType: string; category: string; values: Record<string, unknown>; expressionFields?: string[] },
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x, y: 200 },
    data: {
      label: data.label,
      elementType: data.elementType,
      nodeType: 'plugin',
      category: data.category,
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: data.expressionFields ?? [],
      templateFields: [],
      config: { values: data.values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 150, height: 62 },
  }
}

const CLUSTER = { url: `https://${OPENSEARCH_TARGET_HOST}:${OPENSEARCH_PORT}`, index: 'logs-*', query_language: 'dql' }

function seedNodes(): Array<Record<string, unknown>> {
  return [
    block(NODES.search, 100, {
      label: 'Search',
      elementType: 'opensearch',
      category: 'database',
      values: { ...CLUSTER, mode: 'search', fields: rows(FIELDS) },
    }),
    block(NODES.aggregate, 300, {
      label: 'Aggregate',
      elementType: 'opensearch',
      category: 'database',
      values: { ...CLUSTER, mode: 'aggregate', stats: rows(STATS) },
    }),
    block(NODES.python, 500, {
      label: 'Python',
      elementType: 'python',
      category: 'system',
      values: { script_type: 'source', script: 'import sys\nprint(sys.argv[1:])', arguments: rows(['alpha', 'run_id']) },
      expressionFields: ['arguments.1.value'],
    }),
    block(NODES.http, 700, {
      label: 'HTTP',
      elementType: 'http-client',
      category: 'network',
      values: {
        url: `http://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}/echo`,
        method: 'POST',
        body_mode: 'multipart',
        response_mode: 'body',
        parts: PARTS,
        verify_ssl: true,
      },
    }),
  ]
}

async function seed(request: APIRequestContext): Promise<string> {
  const ids = Object.values(NODES)
  const testId = await createValidTest(request, {
    name: `zz-11541-s2-list-fields-${randomUUID().slice(0, 8)}`,
    nodes: seedNodes(),
    edges: ids.map((target, index) => ({
      id: `e-${target}`,
      source: index === 0 ? 'start-node' : ids[index - 1],
      target,
    })),
    variables: { run_id: { value: 'r-42', type: 'string', scope: 'test' } },
  })
  expect((await validateTest(request, testId)).errors, 'the seeded Test validates with zero errors').toEqual([])
  return testId
}

async function expectColor(target: Locator, token: string, what: string): Promise<void> {
  expect(await elementColor(target, 'color'), what).toBe(await resolvedColor(target.page(), token))
}

/** The line, its color, the expand and the `{ }` beside it (FIELD-1, FIELD-10). */
async function expectListLine(sheet: Locator, name: string, label: string, text: string, color = LIST_COLOR): Promise<Locator> {
  const box = fieldBox(sheet, name)
  await expect(box, `${label} line`).toHaveValue(text)
  await expectColor(box, color, `${label} line color`)
  expect(await box.evaluate((el) => getComputedStyle(el).fontFamily), `${label} is monospace`).toMatch(/mono/i)
  await expect(fieldExpand(sheet, name)).toHaveAccessibleName(`Open editor for ${label}`)
  return box
}

async function attach(testInfo: TestInfo, name: string, sheet: Locator): Promise<void> {
  await testInfo.attach(name, { body: await sheet.screenshot(), contentType: 'image/png' })
}

async function storedValues(page: Page, testId: string, nodeId: string): Promise<Record<string, any>> {
  return (await storedBlock(page.request, testId, nodeId)).config.values as Record<string, any>
}

async function openSearchLines(page: Page, testId: string, theme: Theme, testInfo: TestInfo): Promise<void> {
  const searchValues = await storedValues(page, testId, NODES.search)
  expect(oneLine(searchValues.fields.map((row: { value: unknown }) => row.value)), 'the stored Fields').toBe(FIELDS_LINE)
  let sheet = await openBlockSheet(page, NODES.search)
  await expectListLine(sheet, 'fields', 'Fields', FIELDS_LINE)
  await expect(fieldReset(sheet, 'fields'), 'Fields holds a value over its default').toBeVisible()
  await expect(fieldToggle(sheet, 'fields')).toBeVisible()
  await attach(testInfo, `opensearch-fields-${theme}.png`, sheet)
  await closeUnchangedSheet(sheet)

  const aggregateValues = await storedValues(page, testId, NODES.aggregate)
  expect(oneLine(aggregateValues.stats.map((row: { value: unknown }) => row.value)), 'the stored Stats').toBe(STATS_LINE)
  sheet = await openBlockSheet(page, NODES.aggregate)
  const stats = await expectListLine(sheet, 'stats', 'Stats', STATS_LINE)
  expect(STATS_LINE.startsWith('[{"stat": "count"}, '), 'one space after each comma and colon').toBe(true)
  await expectCut(stats, 'Stats')
  await expect(fieldToggle(sheet, 'stats')).toBeVisible()
  await attach(testInfo, `opensearch-stats-${theme}.png`, sheet)
  await closeUnchangedSheet(sheet)
}

/** `{{ run_id }}` drawn unquoted in the expression color inside the list line (FIELD-6). */
async function pythonLine(page: Page, testId: string, theme: Theme, testInfo: TestInfo): Promise<void> {
  const stored = await storedBlock(page.request, testId, NODES.python)
  expect(stored.config.values.arguments, 'the stored Arguments rows').toEqual(rows(['alpha', 'run_id']))
  expect(stored.expressionFields, 'the second item is {x}').toContain('arguments.1.value')
  const sheet = await openBlockSheet(page, NODES.python)
  await openGroup(sheet, 'Script')
  const box = fieldBox(sheet, 'arguments')
  await expect(box).toHaveValue(ARGUMENTS_LINE)
  const listColor = await resolvedColor(page, LIST_COLOR)
  const expressionColor = await resolvedColor(page, EXPRESSION_COLOR)
  expect(await lineSegments(sheet, 'arguments'), 'the line runs in its colors').toEqual([
    { text: '["alpha", ', color: listColor },
    { text: '{{ run_id }}', color: expressionColor },
    { text: ']', color: listColor },
  ])
  await expect(fieldExpand(sheet, 'arguments')).toHaveAccessibleName('Open editor for Arguments')
  await expect(fieldToggle(sheet, 'arguments'), 'Arguments takes no {x} of its own').toHaveCount(0)
  await attach(testInfo, `python-arguments-${theme}.png`, sheet)
  await closeUnchangedSheet(sheet)
}

async function httpLines(page: Page, testId: string, theme: Theme, testInfo: TestInfo): Promise<void> {
  const values = await storedValues(page, testId, NODES.http)
  expect(values.parts, 'the stored Parts').toEqual(PARTS)
  expect('cipher_suites' in values, 'Cipher Suites is not stored').toBe(false)
  const tls = await tlsCapabilities(page.request)
  const defaults = tls.defaults['http-client']['1.2-1.3']
  expect(defaults, 'the unset list for TLS 1.2 to 1.3 is the whole catalog in catalog order').toEqual(
    tls.ciphers.map((row) => row.openssl),
  )

  const sheet = await openBlockSheet(page, NODES.http)
  await openGroup(sheet, 'Body')
  const parts = await expectListLine(sheet, 'parts', 'Parts', oneLine(PARTS))
  expect(oneLine(PARTS).startsWith(PARTS_HEAD), 'the Parts line spacing').toBe(true)
  await expectCut(parts, 'Parts')
  await expect(fieldToggle(sheet, 'parts')).toBeVisible()

  await openGroup(sheet, 'TLS / Certificates')
  const verify = fieldLabel(sheet, 'verify_ssl')
  await expect(verify).toHaveText('Verify Server Certificate')
  expect(await lineCount(verify), 'the label wraps onto two lines').toBe(2)
  expect(await verify.evaluate((el) => el.scrollWidth <= el.clientWidth), 'the label reads in full').toBe(true)
  await expect(checkbox(sheet, 'verify_ssl')).toHaveAttribute('data-state', 'checked')
  await expect(fieldExpand(sheet, 'verify_ssl'), 'true / false has no expand').toHaveCount(0)
  await expect(fieldToggle(sheet, 'verify_ssl')).toBeVisible()

  const cipherLine = oneLine(defaults)
  expect(cipherLine.startsWith('["ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-'), 'the catalog leads').toBe(true)
  const ciphers = await expectListLine(sheet, 'cipher_suites', 'Cipher Suites', cipherLine, TEXT_MUTED)
  await expectCut(ciphers, 'Cipher Suites')
  await expect(fieldReset(sheet, 'cipher_suites'), 'a not-set field has no reset icon').toHaveCount(0)
  await expect(fieldToggle(sheet, 'cipher_suites')).toBeVisible()
  await attach(testInfo, `http-parts-tls-${theme}.png`, sheet)
  await closeUnchangedSheet(sheet)
}

test.describe('V-FIELD-LIST-FIELDS: one-line list fields', () => {
  let testId = ''

  test.afterEach(async ({ page }) => {
    await deleteSeededTest(page, testId)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
    test(`Fields, Stats, Arguments, Parts, Verify Server Certificate and Cipher Suites in the ${theme} theme`, async ({
      page,
    }, testInfo) => {
      testId = await seed(page.request)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      await test.step('OpenSearch Fields and Stats', () => openSearchLines(page, testId, theme, testInfo))
      await test.step('Python Arguments', () => pythonLine(page, testId, theme, testInfo))
      await test.step('HTTP Parts, Verify Server Certificate, Cipher Suites', () =>
        httpLines(page, testId, theme, testInfo),
      )
    })
  }
})
