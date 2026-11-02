/**
 * V-NULL-OPENSEARCH-FUNCTIONAL: a null value in the OpenSearch Query row
 * Wireframe: N/A
 * Design Decisions: OS-5
 * REQ: REQ-3.3.2.6, REQ-3.1.3.22
 *
 * One workflow on a per-test index of two documents. The Query DSL shape is a script query whose
 * script reads `params.v == null`: OpenSearch accepts a JSON null as a script parameter (a term,
 * terms or match query on a null value is refused), and the answer tells null from empty text, since
 * only a null `v` matches the documents. The failing cases each sit in a Try/Catch whose Catch path
 * logs the caught error, so one run covers them all.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero errors.
 * 2. Query DSL with `{{ nothing }}` (a string variable holding null) standing alone as a JSON value
 *    runs: the Rendered line and the `POST /<index>/_search` request WAVE logs carry `"v": null`, the
 *    cluster reads it as null and Total results is 2, the Results rows are both documents.
 * 3. The same shape with `{{ empty }}` (empty text) sends `"v": ""`, not null: Total results 0.
 * 4. `{{ nothing }}` inside a JSON string in Query DSL fails the block with
 *    `'{{ nothing }}' in 'query' is null` before any request: the Try/Catch catches exactly that text
 *    and the block wrote no request line and no Search line.
 * 5. `{{ nothing }}` outside quotes in DQL fails the same way, with the same text.
 * 6. `{{ nothing }}` inside a DQL quoted phrase fails the same way, with the same text.
 * 7. Each Catch path logs the caught text, the Logs print in the print form, and the run passes.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  HTTP_FIXTURE_HOST_SENTINEL,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_PORT,
  OPENSEARCH_USER,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  escapeRegExp,
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  openSearchIndexName,
  seedOpenSearch,
  type OpenSearchDoc,
  type OpenSearchMappings,
} from '../../helpers/opensearch-stack'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'
import { deleteTest } from '../file-picker/picker'

interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    description: string
    expressionFields: string[]
    templateFields: string[]
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture extends Record<string, unknown> {
  workflow: { nodes: FixtureNode[] }
}

const FIXTURE_FILE = 'fixture-opensearch.json'
const BOOKEND = 'nv-os-done'
const DIRECT_URL = `https://${HTTP_FIXTURE_HOST_SENTINEL}:${OPENSEARCH_PORT}`
const WINDOW_FROM = '2026-10-01T11:59:00.000Z'
const WINDOW_TO = '2026-10-01T12:01:00.000Z'
/** The null-piece message for `{{ nothing }}` in the Query row. */
const NULL_PIECE = "'{{ nothing }}' in 'query' is null"
const MAPPINGS: OpenSearchMappings = {
  properties: { '@timestamp': { type: 'date' }, msg: { type: 'keyword' } },
}
const DOCS: OpenSearchDoc[] = [
  { '@timestamp': '2026-10-01T12:00:00.000Z', msg: 'alpha' },
  { '@timestamp': '2026-10-01T12:00:01.000Z', msg: 'beta' },
]
const SCRIPT_SOURCE = 'params.v == null'

/** The cases that must fail before any request: block, Catch Log tag and variable prefix. */
const REFUSED = [
  { block: 'DSL null quoted', tag: 'dsl-quoted', prefix: 'dsl_quoted', where: 'inside a JSON string' },
  { block: 'DQL null bare', tag: 'dql-bare', prefix: 'dql_bare', where: 'outside quotes in DQL' },
  { block: 'DQL null quoted', tag: 'dql-quoted', prefix: 'dql_quoted', where: 'inside a DQL quoted phrase' },
] as const

const createdTests: string[] = []
let token = ''

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
}

/** Every OpenSearch block dials the direct node as `wave` and stores no secret; the spec fills them. */
function prepareFixture(fixture: Fixture): Fixture {
  for (const node of fixture.workflow.nodes) {
    if (node.data.elementType !== 'opensearch') continue
    const values = node.data.config.values
    const what = `"${node.data.description}"`
    expect(node.data.label, `${what} is named as it is described`).toBe(node.data.description)
    expect(node.data.templateFields, `${what} fills {{ }} in its Query row`).toEqual(['query'])
    expect(node.data.expressionFields, `${what} has no expression row`).toEqual([])
    expect(values.url, `${what} carries the host-mode address the import rewrites`).toBe(DIRECT_URL)
    expect(values.username, `${what} logs in as wave`).toBe(OPENSEARCH_USER)
    expect(values.password, `${what} stores no password`).toBe('')
    expect(values.ca_cert, `${what} stores no CA`).toBe('')
    values.password = OPENSEARCH_PASSWORD
    values.ca_cert = CA_CERT_PEM
  }
  return fixture
}

function nodeOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

function blockEntries(entries: readonly LogEntry[], name: string): LogEntry[] {
  const source = blockSource('OpenSearch', name)
  return entries.filter((entry) => entry.source === source)
}

/** The script query with `v` as the cluster must receive it. */
function scriptQuery(v: unknown): Record<string, unknown> {
  return { script: { script: { source: SCRIPT_SOURCE, params: { v } } } }
}

test.describe('V-NULL-OPENSEARCH-FUNCTIONAL: a null {{ }} value in the Query row', () => {
  test.beforeAll(async () => {
    token = newToken()
    const index = openSearchIndexName(token, 'nulls')
    await createOpenSearchIndex(index, MAPPINGS)
    await seedOpenSearch(index, DOCS)
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('standalone null in Query DSL is sent as JSON null; inside quotes or in DQL it fails before any request', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const index = openSearchIndexName(token, 'nulls')
    const fixture = prepareFixture(withToken(loadFixture(), token))

    const testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })
    createdTests.push(testId)
    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, `zero errors. Got: ${JSON.stringify(validation.errors)}`).toHaveLength(0)

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 150_000)

    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const dump = formatEntries(entries)
    const rendered = (name: string): string[] =>
      blockEntries(entries, name)
        .filter((entry) => entry.level === 'DEBUG' && entry.message.startsWith("Rendered 'query': "))
        .map((entry) => entry.message)
    const requestBodies = (name: string): string[] => {
      const head = `POST /${index}/_search `
      return blockEntries(entries, name)
        .filter((entry) => entry.level === 'DEBUG' && entry.message.startsWith(head))
        .map((entry) => entry.message.slice(head.length))
    }
    const summary = (total: number): RegExp =>
      new RegExp(
        `^Search ${escapeRegExp(index)} from ${escapeRegExp(WINDOW_FROM)} to ${escapeRegExp(WINDOW_TO)}: ` +
          `${total} results?, ${total} kept, \\d+\\.\\d{2} s$`,
      )
    const infoLines = (name: string): string[] =>
      blockEntries(entries, name)
        .filter((entry) => entry.level === 'INFO' || entry.level === 'WARN')
        .map((entry) => `${entry.level} ${entry.message}`)

    await test.step('Query DSL: a null piece standing alone is sent as JSON null and read as null (OS-5)', async () => {
      await expectNodeStatus(page, nodeOf(fixture, 'DSL null alone').id, 'success')
      expect(rendered('DSL null alone'), `the Rendered line.\n${dump}`).toEqual([
        `Rendered 'query': {"script": {"script": {"source": "${SCRIPT_SOURCE}", "params": {"v": null}}}}`,
      ])
      const bodies = requestBodies('DSL null alone')
      expect(bodies, `one search request.\n${dump}`).toHaveLength(1)
      expect(bodies[0], 'the logged request carries v as JSON null').toMatch(/"params":\s*\{"v":\s*null\}/)
      const sent = JSON.parse(bodies[0]) as { query: { bool: { filter: unknown[] } } }
      expect(sent.query.bool.filter[1], 'the author query follows the time range unchanged').toEqual(
        scriptQuery(null),
      )
      const lines = infoLines('DSL null alone')
      expect(lines, `one INFO line and no WARN.\n${dump}`).toHaveLength(1)
      expect(lines[0].replace(/^INFO /, ''), 'the cluster matched both documents').toMatch(summary(2))
      expect(sessionValue(variables, 'alone_null_total'), 'params.v == null held for every document').toBe(2)
      expect(sessionTable(variables, 'alone_null_rows'), 'both documents, newest first').toEqual({
        columns: [
          { name: '@timestamp', type: 'string' },
          { name: 'msg', type: 'string' },
        ],
        rows: [
          [DOCS[1]['@timestamp'], 'beta'],
          [DOCS[0]['@timestamp'], 'alpha'],
        ],
      })
    })

    await test.step('Query DSL: empty text standing alone is the empty string, never null (OS-5)', async () => {
      await expectNodeStatus(page, nodeOf(fixture, 'DSL empty alone').id, 'success')
      expect(rendered('DSL empty alone'), `the Rendered line.\n${dump}`).toEqual([
        `Rendered 'query': {"script": {"script": {"source": "${SCRIPT_SOURCE}", "params": {"v": ""}}}}`,
      ])
      const bodies = requestBodies('DSL empty alone')
      expect(bodies, `one search request.\n${dump}`).toHaveLength(1)
      const sent = JSON.parse(bodies[0]) as { query: { bool: { filter: unknown[] } } }
      expect(sent.query.bool.filter[1]).toEqual(scriptQuery(''))
      const lines = infoLines('DSL empty alone')
      expect(lines, `one INFO line and no WARN.\n${dump}`).toHaveLength(1)
      expect(lines[0].replace(/^INFO /, ''), 'no document matched').toMatch(summary(0))
      expect(sessionValue(variables, 'alone_empty_total')).toBe(0)
      expectConsoleLine(entries, 'INFO', 'nv-os-alone null_total=2 empty_total=0')
    })

    for (const refused of REFUSED) {
      await test.step(`a null piece ${refused.where} fails with the null-piece message before any request (REQ-3.1.3.22)`, async () => {
        const node = nodeOf(fixture, refused.block)
        await expectNodeStatus(page, node.id, 'failed')
        expect(sessionValue(variables, `${refused.prefix}_caught`), 'the Try/Catch caught it').toBe(true)
        const error = sessionValue(variables, `${refused.prefix}_error`) as Record<string, unknown>
        expect(error.message, 'the caught text is the null-piece message, exactly').toBe(NULL_PIECE)
        expect(error.node_id, 'the error points at the block').toBe(node.id)
        expectConsoleLine(entries, 'ERROR', `Block '${refused.block}' failed: ${NULL_PIECE}`)
        expectConsoleLine(entries, 'INFO', `nv-os-${refused.tag} caught=true message=${NULL_PIECE}`)
        const sentOrSearched = blockEntries(entries, refused.block).filter(
          (entry) =>
            /^(GET|HEAD|POST|PUT|DELETE) \//.test(entry.message) ||
            entry.message.startsWith('Search ') ||
            entry.message.startsWith("Rendered 'query': ") ||
            entry.message.startsWith('Inputs: '),
        )
        expect(sentOrSearched, `nothing was rendered or sent.\n${dump}`).toEqual([])
        expect(sessionValue(variables, `${refused.prefix}_total`), 'no Total results was bound').toBe(-1)
      })
    }

    await test.step('every Catch path ran and the run passes', async () => {
      for (const description of ['Standalone proof', 'DSL quoted caught', 'DQL bare caught', 'DQL quoted caught', 'Done']) {
        await expectNodeStatus(page, nodeOf(fixture, description).id, 'success')
      }
      expectConsoleLine(entries, 'INFO', `${BOOKEND} caught=true/true/true`)
      const leaked = entries.filter((entry) => entry.message.includes(OPENSEARCH_PASSWORD))
      expect(leaked, 'no console line carries the password').toEqual([])
    })
  })
})
