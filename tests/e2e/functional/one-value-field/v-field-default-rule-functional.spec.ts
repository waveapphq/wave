/**
 * V-FIELD-DEFAULT-RULE-FUNCTIONAL: the default rule on every free-entry field type of a Block.
 * Design Decisions: FIELD-2 (gray default, typing replaces it, Delete explains, select all + Delete), FIELD-3 (reset icon),
 *   FIELD-4 (`<empty string>`), FIELD-7 (a not-set field switches with no warning and copies nothing)
 * REQ: REQ-3.1.1.5
 *
 * Pass Criteria:
 * 1. Text (Shell Exec Shell), map (Shell Exec Input Variables), integer (HTTP Max Redirects), float (HTTP Retry Delay),
 *    list (HTTP Retryable Codes) and table (Function Block input with a default) left not set show the default as real
 *    text in Text Muted in literal mode, with no reset icon.
 * 2. Delete and Backspace leave the gray default whole and open the tooltip
 *    `Not set, so the default is used. Type to use your own value.`
 * 3. Typing over the gray default replaces all of it: the box holds exactly the typed text in the type's value color,
 *    with the reset icon.
 * 4. Select all + Delete takes the field back to not set (gray default, no reset icon).
 * 5. The reset icon takes a typed value back to not set.
 * 6. {x} on a not-set field switches with no warning and copies nothing in: the {x} box is empty and its gray hint is
 *    the default as a Python literal (`'/bin/sh'`, `{}`, `10`, `1.0`, `['502', '503', '504']`,
 *    `[{'name': 'alpha'}, {'name': 'beta'}]`, `''`); switching back shows the gray default again, still not set.
 * 7. Save with every field not set (left blank in {x}) stores nothing for them: GET /tests/{id} holds no value and no
 *    {x} flag, and the next open shows each field in literal mode, not set.
 * 8. The run uses every default: `$0` is `/bin/sh` and no Input Variable is exported; ten redirects pass under Max
 *    Redirects 10; a 503 is retried under the default codes and delay (DEBUG line names them); the Function Block gets
 *    each input's default; the OpenSearch search with Query not set sends no filter and returns both documents.
 * 9. Code (OpenSearch Query, default empty text) follows the same rule: not set shows the gray `<empty string>`, the {x}
 *    hint is `''`, and Save stores nothing.
 *
 * Phase: functional-workflow (imports its own fixtures and seeds its own OpenSearch index; deletes both after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { CA_CERT_PEM, OPENSEARCH_PASSWORD, OPENSEARCH_USER } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { readFixture } from '../../helpers/element-types'
import { setConsoleMinimumLevel, formatEntries, type LogEntry } from '../../helpers/log-reader'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  openSearchIndexName,
  seedOpenSearch,
  type OpenSearchDoc,
  type OpenSearchMappings,
} from '../../helpers/opensearch-stack'
import { openBlockSheet, runToEnd, saveBlockSheet, saveTest, selectEnvironment } from '../../helpers/workbench'
import { closeUnchangedSheet, deleteSeededTest, openGroup, storedBlock } from '../../helpers/list-fields'
import { resetButton } from '../../helpers/value-field'
import {
  expectDefaultKeyHint,
  expectExpression,
  expectGrayDefault,
  expectGrayEmptyDefault,
  expectNothingStored,
  expectStored,
  expectUserValue,
  selectAllAndDelete,
  storedFields,
  switchSilently,
  typeKeys,
  type FreeEntryType,
} from '../../helpers/default-rule'
import { newToken, withToken } from '../shell-blocks/shell-helpers'

interface BlockRef {
  id: string
  label: string
}

interface RuleField {
  block: BlockRef
  name: string
  type: FreeEntryType
  /** The collapsed group card the row sits in. */
  group?: string
  /** The default as the box shows it. */
  shown: string
  /** The default as the {x} hint shows it: a Python literal. */
  hint: string
  /** What the user types over the gray default. */
  typed: string
}

const SHELL: BlockRef = { id: 'f41fa3af-20aa-497b-be12-9bd63c6e6c7c', label: 'Shell Defaults' }
const REDIRECT: BlockRef = { id: '45cf6657-0a92-4987-ac0c-baea37c1f7b8', label: 'Redirect Ten' }
const RETRY: BlockRef = { id: '7f9bc89a-b744-4623-8a7a-032c141e6a8f', label: 'Retry Once' }
const FN: BlockRef = { id: 'b706b9d0-5781-43fe-910c-81339e90b90c', label: 'defaults_fn' }
const SEARCH: BlockRef = { id: '64bc9d38-2803-4fa5-9770-eb6290732861', label: 'Query Default' }

const RULE_FIELDS: readonly RuleField[] = [
  { block: SHELL, name: 'shell', type: 'string', shown: '/bin/sh', hint: "'/bin/sh'", typed: '/bin/bash' },
  { block: SHELL, name: 'env_vars', type: 'map', shown: '{}', hint: '{}', typed: '{"B": "2"}' },
  { block: REDIRECT, name: 'max_redirects', type: 'integer', group: 'Connection', shown: '10', hint: '10', typed: '12' },
  { block: RETRY, name: 'retry_delay', type: 'float', group: 'Timeouts & Retries', shown: '1', hint: '1.0', typed: '2.5' },
  {
    block: RETRY,
    name: 'retryable_status_codes',
    type: 'array',
    group: 'Timeouts & Retries',
    shown: '["502", "503", "504"]',
    hint: "['502', '503', '504']",
    typed: '["500"]',
  },
  {
    block: FN,
    name: 'grid',
    type: 'table',
    shown: '[{"name": "alpha"}, {"name": "beta"}]',
    hint: "[{'name': 'alpha'}, {'name': 'beta'}]",
    typed: '[{"name": "gamma"}]',
  },
]

const RULE_BLOCKS: readonly BlockRef[] = [SHELL, REDIRECT, RETRY, FN]

const SEARCH_MAPPINGS: OpenSearchMappings = {
  properties: { '@timestamp': { type: 'date' }, msg: { type: 'keyword' } },
}
const SEARCH_DOCS: OpenSearchDoc[] = [
  { '@timestamp': '2026-10-01T12:00:00.000Z', msg: 'alpha' },
  { '@timestamp': '2026-10-01T12:00:01.000Z', msg: 'beta' },
]

const RETRY_DEFAULTS_LINE = /^Retry: 1x, delay 1(\.0)?s, backoff 2(\.0)?x, codes \['502', '503', '504'\]$/

function fieldsOf(block: BlockRef): RuleField[] {
  return RULE_FIELDS.filter((field) => field.block === block)
}

async function openRuleSheet(page: Page, block: BlockRef): Promise<Locator> {
  const sheet = await openBlockSheet(page, block.id)
  for (const group of new Set(fieldsOf(block).flatMap((field) => field.group ?? []))) await openGroup(sheet, group)
  return sheet
}

/** FIELD-2, FIELD-3, FIELD-7 on one not-set field; it ends blank in {x}, which a Save stores as nothing. */
async function walkDefaultRule(page: Page, sheet: Locator, field: RuleField): Promise<void> {
  const { name } = field
  await test.step(`${name}: not set shows the default in gray`, async () => {
    await expectGrayDefault(sheet, name, field.shown)
  })
  await test.step(`${name}: Delete and Backspace leave the default and explain it`, async () => {
    await expectDefaultKeyHint(page, sheet, name, 'Delete')
    await expectDefaultKeyHint(page, sheet, name, 'Backspace')
    await expectGrayDefault(sheet, name, field.shown)
  })
  await test.step(`${name}: typing over the gray default replaces all of it`, async () => {
    await typeKeys(page, sheet, name, field.typed)
    await expectUserValue(sheet, name, field.type, field.typed)
  })
  await test.step(`${name}: select all + Delete returns to not set`, async () => {
    await selectAllAndDelete(page, sheet, name)
    await expectGrayDefault(sheet, name, field.shown)
  })
  await test.step(`${name}: the reset icon brings the default back`, async () => {
    await typeKeys(page, sheet, name, field.typed)
    await expectUserValue(sheet, name, field.type, field.typed)
    await resetButton(sheet, name).click()
    await expectGrayDefault(sheet, name, field.shown)
  })
  await test.step(`${name}: {x} on a not-set field copies nothing in, and back shows the default`, async () => {
    await switchSilently(page, sheet, name, true)
    await expectExpression(sheet, name, '', field.hint)
    await switchSilently(page, sheet, name, false)
    await expectGrayDefault(sheet, name, field.shown)
    await switchSilently(page, sheet, name, true)
    await expectExpression(sheet, name, '', field.hint)
  })
}

function messages(entries: readonly LogEntry[]): string[] {
  return entries.map((entry) => entry.message)
}

test.describe('V-FIELD-DEFAULT-RULE-FUNCTIONAL: the default rule on every free-entry field type', () => {
  let testId = ''
  let token = ''

  test.afterEach(async ({ page }) => {
    await deleteSeededTest(page, testId)
    testId = ''
    if (token) await deleteOpenSearchIndexes(token)
    token = ''
  })

  test('text, map, integer, float, list and table fields: gray default, typing, reset, {x}, Save stores nothing, the run uses the default', async ({
    page,
  }) => {
    test.setTimeout(360_000)
    const fixture = withToken(readFixture(__dirname, 'fixture-default-rule.json'), newToken())
    testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })

    for (const block of RULE_BLOCKS) {
      await test.step(`${block.label}: every field it leaves not set`, async () => {
        const sheet = await openRuleSheet(page, block)
        for (const field of fieldsOf(block)) await walkDefaultRule(page, sheet, field)
        await saveBlockSheet(sheet)
      })
    }

    await test.step('Save stores nothing for a field that is not set', async () => {
      await saveTest(page)
      for (const block of RULE_BLOCKS) {
        const stored = storedFields(await storedBlock(page.request, testId, block.id))
        for (const field of fieldsOf(block)) expectNothingStored(stored, field.name, block.label)
      }
      const retry = storedFields(await storedBlock(page.request, testId, RETRY.id))
      expectStored(retry, 'retry_count', 1, false, 'Retry Once keeps its own value')
    })

    await test.step('the next open shows every field in literal mode, not set', async () => {
      for (const block of RULE_BLOCKS) {
        const sheet = await openRuleSheet(page, block)
        for (const field of fieldsOf(block)) await expectGrayDefault(sheet, field.name, field.shown)
        await closeUnchangedSheet(sheet)
      }
    })

    await test.step('the run uses every default', async () => {
      await setConsoleMinimumLevel(page, 'DEBUG')
      await selectEnvironment(page)
      const run = await runToEnd(page)
      const dump = formatEntries(run.entries)
      expect(run.verdict, `the run passes; console:\n${dump}`).toBe('passed')
      const lines = messages(run.entries)
      expect(lines, `the shell is /bin/sh and no Input Variable is set; console:\n${dump}`).toContain(
        'shell-out shell=/bin/sh a=unset',
      )
      expect(lines, `ten redirects pass and the 503 is retried; console:\n${dump}`).toContain(
        'http redirect=200 retry=200',
      )
      expect(
        lines.filter((line) => RETRY_DEFAULTS_LINE.test(line)),
        `the retry runs under the default delay and codes; console:\n${dump}`,
      ).toHaveLength(1)
      expect(lines, `the Function Block gets every input default; console:\n${dump}`).toContain(
        'fn region=eu-west-1 tries=3 ratio=2.5 labels=1+2 opts=1 grid=beta notes=second line',
      )
    })
  })

  test('code field (OpenSearch Query): gray empty default, typing, reset, {x} hint, Save stores nothing, the run sends no filter', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    token = newToken()
    const index = openSearchIndexName(token, 'defaults')
    await createOpenSearchIndex(index, SEARCH_MAPPINGS)
    await seedOpenSearch(index, SEARCH_DOCS)

    const fixture = withToken(readFixture(__dirname, 'fixture-default-rule-code.json'), token)
    const search = (fixture.workflow.nodes as Array<Record<string, any>>).find((node) => node.id === SEARCH.id)!
    const values = search.data.config.values as Record<string, unknown>
    expect(values.username, 'the search logs in as wave').toBe(OPENSEARCH_USER)
    expect(Object.hasOwn(values, 'query'), 'the fixture leaves Query not set').toBe(false)
    values.password = OPENSEARCH_PASSWORD
    values.ca_cert = CA_CERT_PEM
    testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })

    const sheet = await openBlockSheet(page, SEARCH.id)
    await test.step('query: not set shows the gray <empty string>, Delete explains it', async () => {
      await expectGrayEmptyDefault(sheet, 'query')
      await expectDefaultKeyHint(page, sheet, 'query', 'Delete')
      await expectGrayEmptyDefault(sheet, 'query')
    })
    await test.step('query: typing replaces the default; select all + Delete returns to not set', async () => {
      await typeKeys(page, sheet, 'query', 'msg:alpha')
      await expectUserValue(sheet, 'query', 'string', 'msg:alpha')
      await selectAllAndDelete(page, sheet, 'query')
      await expectGrayEmptyDefault(sheet, 'query')
    })
    await test.step('query: the reset icon brings the default back', async () => {
      await typeKeys(page, sheet, 'query', 'msg:beta')
      await expectUserValue(sheet, 'query', 'string', 'msg:beta')
      await resetButton(sheet, 'query').click()
      await expectGrayEmptyDefault(sheet, 'query')
    })
    await test.step("query: {x} copies nothing in and hints ''; back shows the default", async () => {
      await switchSilently(page, sheet, 'query', true)
      await expectExpression(sheet, 'query', '', "''")
      await switchSilently(page, sheet, 'query', false)
      await expectGrayEmptyDefault(sheet, 'query')
      await switchSilently(page, sheet, 'query', true)
      await expectExpression(sheet, 'query', '', "''")
      await saveBlockSheet(sheet)
    })

    await test.step('Save stores nothing for Query', async () => {
      await saveTest(page)
      expectNothingStored(storedFields(await storedBlock(page.request, testId, SEARCH.id)), 'query', SEARCH.label)
    })

    await test.step('the run sends no filter: both documents come back', async () => {
      await selectEnvironment(page)
      const run = await runToEnd(page)
      const dump = formatEntries(run.entries)
      expect(run.verdict, `the run passes; console:\n${dump}`).toBe('passed')
      expect(messages(run.entries), `no filter, so both documents; console:\n${dump}`).toContain('os total=2')
    })
  })
})
