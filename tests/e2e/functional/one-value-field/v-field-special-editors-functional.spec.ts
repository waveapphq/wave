/**
 * V-FIELD-SPECIAL-EDITORS-FUNCTIONAL: list settings built in the shared list editor and in the Fields and Stats editors
 * Design Decisions: FIELD-6, FIELD-7, FIELD-10, FIELD-13, SHRUN-4, SQL-6, OS-6, OS-7, OS-13
 * REQ: REQ-3.1.1.5, REQ-3.1.3.20, REQ-3.1.3.21, REQ-3.4.1.1, REQ-3.4.1.2, REQ-3.4.1.6, REQ-3.4.1.15
 *
 * Three fixtures, each imported through POST /tests with zero validation errors, edited through the Block
 * windows only and run through the UI against the real stack (`postgres`, `opensearch`).
 *
 * Pass Criteria:
 * 1. Shell Script Arguments: expand opens the shared list editor with `$1 alpha`; Add argument appends
 *    `$2` and `$3`; item 2 switched to {x} holds `run_id` with no question (it held nothing); the
 *    controls are named `Remove argument $2` and `Move argument $3 up`; Save writes the one-line field
 *    `["alpha", {{ run_id }}, "last word"]` and the stored rows `[{value: alpha}, {value: run_id},
 *    {value: last word}]` with `expressionFields` `arguments.1.value`; reopened, the editor shows the
 *    same three items, item 2 in {x}.
 * 2. Python Arguments: the same build stores the same rows and flag.
 * 3. A null item: the null button inside item 2's box turns it into `null` with the button pressed; the
 *    line reads `["a", null]`; the stored row is `{value: null}` with no {x} flag.
 * 4. The run: Shell prints `alpha|r-<token>|last word|n=3`, Python the same; each Block with a null
 *    item fails with exactly `Row 2 in 'arguments' is null` (its Try/Catch logs the message) and the
 *    run passes.
 * 5. SQL Out arguments on `postgres`: the editor numbers its items from `1` and adds with `Add argument`;
 *    item 2 in {x} holds `label_arg`; stored `out_arguments` `[{value: total}, {value: label_arg}]` with
 *    `out_arguments.1.value`; the run's Out values hold one row, `total` 5 and `label` `sum`.
 * 6. SQL: a null item 1 is stored as `{value: null}` and the call fails with exactly
 *    `Row 1 in 'out_arguments' is null`.
 * 7. OpenSearch Fields editor on `opensearch`: opened on the gray default it shows `@timestamp`; Get
 *    fields in a row's suggestion list pulls the index's fields; `latency_ms` and `service.name` are
 *    picked from the list; Move field 3 up puts `service.name` second; an {x} row holds `extra_field`;
 *    an added `bytes` row is removed; Add reads `Add field`; Save stores the four record rows with
 *    `fields.3.value`; reopened, the rows and the {x} row come back.
 * 8. The Fields run: Results columns `@timestamp`, `service.name`, `latency_ms`, `user.id` (the {x}
 *    row's value) with the ten documents newest first; a null Fields entry ends amber under Record and
 *    continue with Reason Validation and exactly `Fields entry 2 is empty: give a field name or remove
 *    the entry`.
 * 9. OpenSearch Stats editor: Add reads `Add stat`; {x} on `Count` (an entry holding a stat) asks with
 *    the field switch warning (title, body, Cancel / Clear / Clear & Empty) and Cancel keeps Count; an
 *    added `Sum (no field)` entry switches to {x} at once, and back from {x} with text that names no
 *    stat it asks `Switch the field to a plain value?` and Clear returns it to `Sum (no field)`; its
 *    Field set to `latency_ms` reads `Sum of latency_ms`; a third entry in {x} holds `max_stat`; Save
 *    stores the three rows with `stats.2.value`; reopened they read back.
 * 10. The Stats run: one row `count` 10, `sum of latency_ms` 1520, `max of latency_ms` 250; a null Stat
 *     ends amber with Reason Validation and exactly
 *     `Stat 2 must be a map with a stat, such as {"stat": "count"}; it is null`.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  OPENSEARCH_PASSWORD,
  SQL_SEED_PROCEDURE,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
  type WaveTable,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { expectConsoleLine, getLogEntries, type LogEntry } from '../../helpers/log-reader'
import { withSqlStack } from '../../helpers/sql-stack'
import {
  F_METRICS,
  MAP_METRICS,
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  openSearchIndexName,
  seedOpenSearch,
} from '../../helpers/opensearch-stack'
import {
  addListItem,
  addStatEntry,
  clickSuggestFooter,
  closeValueEditor,
  editPreview,
  listAddButton,
  listEntry,
  listItems,
  listMoveUp,
  listPositions,
  openListEditor,
  pickSuggestion,
  saveListEditor,
  setListItemExpression,
  setStatEntry,
  statTrigger,
} from '../../helpers/config-sheet'
import { listItem } from '../../helpers/entry-editors'
import { switchWarning } from '../../helpers/value-field'
import {
  closeConfig,
  deleteTest,
  expandGroup,
  openConfig,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import { newToken, stripOneNewline, withToken } from '../shell-blocks/shell-helpers'

interface FixtureNode {
  id: string
  data: { label: string; elementType: string; config: { values: Record<string, unknown> } }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

type CaughtError = { message: string; node_id: string }

const NULL_ARGUMENT = "Row 2 in 'arguments' is null"
const NULL_OUT_ARGUMENT = "Row 1 in 'out_arguments' is null"
const NULL_FIELD = 'Fields entry 2 is empty: give a field name or remove the entry'
const NULL_STAT = 'Stat 2 must be a map with a stat, such as {"stat": "count"}; it is null'
const TO_EXPRESSION_TITLE = 'Switch the field to an expression?'
const TO_PLAIN_TITLE = 'Switch the field to a plain value?'
const SWITCH_BODY = 'The current value is cleared.'

const createdTests: string[] = []

function loadFixture(file: string, token: string): Fixture {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
  return withToken(raw, token)
}

function nodeId(fixture: Fixture, label: string): string {
  const found = fixture.workflow.nodes.filter((node) => node.data.label === label)
  expect(found, `the fixture declares one Block named "${label}"`).toHaveLength(1)
  return found[0].id
}

function caught(variables: SessionVariables, name: string): CaughtError {
  return sessionValue(variables, name) as CaughtError
}

function columnNames(table: WaveTable): string[] {
  return table.columns.map((column) => column.name)
}

function column(table: WaveTable, name: string): unknown[] {
  const at = columnNames(table).indexOf(name)
  expect(at, `column "${name}" in ${JSON.stringify(columnNames(table))}`).toBeGreaterThanOrEqual(0)
  return table.rows.map((row) => row[at])
}

/** A number cell: a JSON number, or the exact decimal text a float column carries. */
function num(cell: unknown): number {
  return typeof cell === 'number' ? cell : Number(cell)
}

function expectFailedBlock(
  entries: readonly LogEntry[],
  variables: SessionVariables,
  { block, variable, key, message }: { block: string; variable: string; key: string; message: string },
): void {
  const error = caught(variables, variable)
  expect(error.message, `${block} names what is null`).toBe(message)
  expectConsoleLine(entries, 'ERROR', `Block '${block}' failed: ${message}`)
  expectConsoleLine(entries, 'WARN', `caught ${key}: ${message}`)
}

/** The switch warning an entry holding a value asks before {x} changes (FIELD-7). */
async function expectSwitchWarning(page: Page, title: string, buttons: string[]): Promise<Locator> {
  const dialog = switchWarning(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText(new RegExp(`^${title.replace(/[?]/g, '\\?')}$`))
  await expect(dialog.getByText(SWITCH_BODY, { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button').filter({ hasText: /\S/ })).toHaveText(buttons)
  return dialog
}

/** Build the three-item argument list both script Blocks take: alpha, {{ run_id }}, last word. */
async function buildArguments(page: Page, editor: Locator): Promise<void> {
  expect(await listPositions(editor), 'the stored row opens as $1').toEqual(['$1'])
  await expect(listItem(editor, 0).valueInput).toHaveValue('alpha')
  await expect(listAddButton(editor), 'Add is named by its text (SHRUN-4)').toHaveText('Add argument')
  await expect(listAddButton(editor)).not.toHaveAttribute('aria-label')

  await addListItem(editor)
  await setListItemExpression(page, editor, 1, 'run_id')
  await expect(switchWarning(page), 'an item holding nothing switches at once').toHaveCount(0)
  await addListItem(editor, 'last word')

  expect(await listPositions(editor)).toEqual(['$1', '$2', '$3'])
  await expect(listItem(editor, 1).exprToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(listItem(editor, 1).exprBox.locator('.cm-content')).toHaveText('run_id')
  await expect(listItem(editor, 2).exprToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(listItem(editor, 1).remove).toHaveAccessibleName('Remove argument $2')
  await expect(listMoveUp(editor, 2)).toHaveAccessibleName('Move argument $3 up')
  await expect(listItem(editor, 2).valueInput).toHaveAccessibleName('Argument $3 value')
  await saveListEditor(editor)
}

/** Press the null button inside item `index`'s box: the item holds null and the button shows pressed. */
async function nullItem(editor: Locator, index: number): Promise<void> {
  const button = listItem(editor, index).nullButton
  await button.click()
  await expect(listItem(editor, index).nullChip).toBeVisible()
  await expect(listItem(editor, index).nullChip).toContainText('null')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await saveListEditor(editor)
}

test.describe('V-FIELD-SPECIAL-EDITORS-FUNCTIONAL: list settings built in their editors', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('Shell Script and Python Arguments: per-item {x} and null in the shared list editor', async ({ page }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const fixture = loadFixture('fixture-special-arguments.json', token)
    const testId = await importValidateAndNavigate(page, fixture)
    createdTests.push(testId)
    const SH = nodeId(fixture, 'Shell arguments from the editor')
    const PY = nodeId(fixture, 'Python arguments from the editor')
    const SH_NULL = nodeId(fixture, 'Shell argument 2 null')
    const PY_NULL = nodeId(fixture, 'Python argument 2 null')

    for (const [id, block] of [
      [SH, 'Shell Script'],
      [PY, 'Python'],
    ]) {
      await test.step(`${block}: alpha, {{ run_id }} and last word built in the list editor (FIELD-10, SHRUN-4)`, async () => {
        const sheet = await openConfig(page, id)
        await expandGroup(sheet, 'Script')
        await expect(editPreview(sheet, 'arguments')).toHaveValue('["alpha"]')
        await buildArguments(page, await openListEditor(page, sheet, 'arguments'))
        // FIELD-6: the {x} item draws bare in the one-line field.
        await expect(editPreview(sheet, 'arguments')).toHaveValue('["alpha", {{ run_id }}, "last word"]')
        await saveConfig(sheet)
      })
    }

    for (const id of [SH_NULL, PY_NULL]) {
      await test.step(`the null button makes item 2 null (FIELD-13): ${id === SH_NULL ? 'Shell' : 'Python'}`, async () => {
        const sheet = await openConfig(page, id)
        await expandGroup(sheet, 'Script')
        await nullItem(await openListEditor(page, sheet, 'arguments'), 1)
        await expect(editPreview(sheet, 'arguments')).toHaveValue('["a", null]')
        await saveConfig(sheet)
      })
    }

    await test.step('the stored rows: record rows, the {x} flag by row, null kept as null', async () => {
      await saveWorkbench(page)
      const nodes = await persistedNodes(page.request, testId)
      for (const id of [SH, PY]) {
        expect(nodes[id].config.values.arguments).toEqual([
          { value: 'alpha' },
          { value: 'run_id' },
          { value: 'last word' },
        ])
        expect(nodes[id].expressionFields).toEqual(['arguments.1.value'])
      }
      for (const id of [SH_NULL, PY_NULL]) {
        expect(nodes[id].config.values.arguments).toEqual([{ value: 'a' }, { value: null }])
        expect(nodes[id].expressionFields ?? []).toEqual([])
      }
    })

    await test.step('reopened, the editor shows the stored items and the {x} item in its expression slot', async () => {
      const sheet = await openConfig(page, SH)
      await expandGroup(sheet, 'Script')
      const editor = await openListEditor(page, sheet, 'arguments')
      expect(await listPositions(editor)).toEqual(['$1', '$2', '$3'])
      await expect(listItem(editor, 0).valueInput).toHaveValue('alpha')
      await expect(listItem(editor, 1).exprBox.locator('.cm-content')).toHaveText('run_id')
      await expect(listItem(editor, 2).valueInput).toHaveValue('last word')
      await closeValueEditor(page, editor)
      await closeConfig(sheet)
    })

    await test.step('the run: the scripts get $1..$3 in order; a null item fails its Block naming the row', async () => {
      const status = await startRun(page)
      await finishRun(page, status, `zz-11541-s5-args-done-${token}`)
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      const entries = await getLogEntries(page)
      const expected = `alpha|r-${token}|last word|n=3`
      expect(stripOneNewline(String(sessionValue(variables, 'sh_out')))).toBe(expected)
      expect(stripOneNewline(String(sessionValue(variables, 'py_out')))).toBe(expected)
      await expectNodeStatus(page, SH, 'success')
      await expectNodeStatus(page, PY, 'success')
      await expectNodeStatus(page, SH_NULL, 'failed')
      await expectNodeStatus(page, PY_NULL, 'failed')
      expectFailedBlock(entries, variables, {
        block: 'Shell argument 2 null',
        variable: 'e_sh_null',
        key: 'sh-null',
        message: NULL_ARGUMENT,
      })
      expectFailedBlock(entries, variables, {
        block: 'Python argument 2 null',
        variable: 'e_py_null',
        key: 'py-null',
        message: NULL_ARGUMENT,
      })
    })
  })

  test('SQL Out arguments on postgres: per-item {x} names an Out values column, a null name fails', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const raw = JSON.parse(
      JSON.stringify(loadFixture('fixture-special-sql.json', token)).replaceAll('__SEED_PROCEDURE__', SQL_SEED_PROCEDURE),
    ) as Fixture
    const fixture = withSqlStack(raw)
    const testId = await importValidateAndNavigate(page, fixture)
    createdTests.push(testId)
    const CALL = nodeId(fixture, 'Out arguments from the editor')
    const NULL_CALL = nodeId(fixture, 'Null out argument name')

    await test.step('Out arguments: numbered from 1, Add argument, item 2 in {x} (FIELD-10, SQL-6)', async () => {
      const sheet = await openConfig(page, CALL)
      await expect(editPreview(sheet, 'out_arguments')).toHaveValue('["total"]')
      const editor = await openListEditor(page, sheet, 'out_arguments')
      expect(await listPositions(editor)).toEqual(['1'])
      await expect(listAddButton(editor)).toHaveText('Add argument')
      await addListItem(editor)
      await setListItemExpression(page, editor, 1, 'label_arg')
      expect(await listPositions(editor)).toEqual(['1', '2'])
      await expect(listItem(editor, 1).remove).toHaveAccessibleName('Remove argument 2')
      await saveListEditor(editor)
      await expect(editPreview(sheet, 'out_arguments')).toHaveValue('["total", {{ label_arg }}]')
      await saveConfig(sheet)
    })

    await test.step('a null name: the null button on item 1', async () => {
      const sheet = await openConfig(page, NULL_CALL)
      await nullItem(await openListEditor(page, sheet, 'out_arguments'), 0)
      await expect(editPreview(sheet, 'out_arguments')).toHaveValue('[null, "label"]')
      await saveConfig(sheet)
    })

    await test.step('the stored rows', async () => {
      await saveWorkbench(page)
      const nodes = await persistedNodes(page.request, testId)
      expect(nodes[CALL].config.values.out_arguments).toEqual([{ value: 'total' }, { value: 'label_arg' }])
      expect(nodes[CALL].expressionFields).toEqual(['out_arguments.1.value'])
      expect(nodes[NULL_CALL].config.values.out_arguments).toEqual([{ value: null }, { value: 'label' }])
    })

    await test.step('the run: Out values total 5 and label sum; the null name fails naming row 1', async () => {
      const status = await startRun(page)
      await finishRun(page, status, `zz-11541-s5-sql-done-${token}`)
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      const out = sessionTable(variables, 'pg_out')
      expect(columnNames(out), 'one column per out argument, the {x} one by its value').toEqual(['total', 'label'])
      expect(out.rows).toHaveLength(1)
      expect([num(column(out, 'total')[0]), column(out, 'label')[0]]).toEqual([5, 'sum'])
      expect(sessionValue(variables, 'pg_ok')).toBe(true)
      await expectNodeStatus(page, CALL, 'success')
      await expectNodeStatus(page, NULL_CALL, 'failed')
      expectFailedBlock(await getLogEntries(page), variables, {
        block: 'Null out argument name',
        variable: 'e_sql_null',
        key: 'sql-null',
        message: NULL_OUT_ARGUMENT,
      })
    })
  })

  test.describe('OpenSearch Fields and Stats editors on the real cluster', () => {
    let token = ''
    let metrics = ''

    test.beforeAll(async () => {
      token = newToken()
      metrics = openSearchIndexName(token, 'metrics')
      await createOpenSearchIndex(metrics, MAP_METRICS)
      await seedOpenSearch(metrics, F_METRICS)
    })

    test.afterAll(async () => {
      if (token) await deleteOpenSearchIndexes(token)
    })

    test('Fields and Stats: suggestions, move, remove, Add, per-row {x}, null, stored rows round trip', async ({
      page,
    }) => {
      test.setTimeout(300_000)
      const fixture = loadFixture('fixture-special-opensearch.json', token)
      for (const node of fixture.workflow.nodes.filter((n) => n.data.elementType === 'opensearch')) {
        const values = node.data.config.values
        values.index = metrics
        values.password = OPENSEARCH_PASSWORD
        values.ca_cert = CA_CERT_PEM
      }
      const testId = await importValidateAndNavigate(page, fixture as unknown as Record<string, unknown>, {
        injectHttp: true,
        rejectRepairs: true,
      })
      createdTests.push(testId)
      const FIELDS = nodeId(fixture, 'Fields from the editor')
      const FIELDS_NULL = nodeId(fixture, 'Fields with a null entry')
      const STATS = nodeId(fixture, 'Stats from the editor')
      const STATS_NULL = nodeId(fixture, 'Stats with a null entry')

      await test.step('Fields: pulled suggestions, move, remove, Add field and an {x} row (FIELD-10, OS-6, OS-13)', async () => {
        const sheet = await openConfig(page, FIELDS)
        await expect(editPreview(sheet, 'fields'), 'not set, the default shows').toHaveValue('["@timestamp"]')
        const editor = await openListEditor(page, sheet, 'fields')
        expect(await listPositions(editor), 'opened on the default rows').toEqual(['1'])
        await expect(listEntry(editor, 0)).toHaveValue('@timestamp')
        await expect(listAddButton(editor)).toHaveText('Add field')

        await addListItem(editor)
        await clickSuggestFooter(page, listEntry(editor, 1), 'Get fields')
        await pickSuggestion(page, listEntry(editor, 1), 'latency_ms')
        await addListItem(editor)
        await pickSuggestion(page, listEntry(editor, 2), 'service.name')
        await listMoveUp(editor, 2).click()
        await expect(listMoveUp(editor, 1), 'focus stays on the moved row arrow').toBeFocused()
        await expect(listEntry(editor, 1)).toHaveValue('service.name')
        await expect(listEntry(editor, 2)).toHaveValue('latency_ms')

        await addListItem(editor)
        await setListItemExpression(page, editor, 3, 'extra_field')
        await addListItem(editor, 'bytes')
        await expect(listItem(editor, 4).remove).toHaveAccessibleName('Remove field 5')
        await listItem(editor, 4).remove.click()
        await expect(listAddButton(editor), 'removing the last row moves focus to Add').toBeFocused()
        expect(await listPositions(editor)).toEqual(['1', '2', '3', '4'])
        await saveListEditor(editor)
        await expect(editPreview(sheet, 'fields')).toHaveValue(
          '["@timestamp", "service.name", "latency_ms", {{ extra_field }}]',
        )
        await saveConfig(sheet)
      })

      await test.step('Fields: the null button on entry 2', async () => {
        const sheet = await openConfig(page, FIELDS_NULL)
        await nullItem(await openListEditor(page, sheet, 'fields'), 1)
        await expect(editPreview(sheet, 'fields')).toHaveValue('["@timestamp", null]')
        await saveConfig(sheet)
      })

      await test.step('Stats: Add stat, the switch warning on a held stat, {x} back to the Add entry (FIELD-7, OS-7)', async () => {
        const sheet = await openConfig(page, STATS)
        const editor = await openListEditor(page, sheet, 'stats')
        await expect(statTrigger(editor, 0)).toHaveText('Count')
        await expect(listAddButton(editor)).toHaveText('Add stat')

        // An entry holding a stat asks before {x} clears it; Cancel keeps it.
        await listItem(editor, 0).exprToggle.click()
        const ask = await expectSwitchWarning(page, TO_EXPRESSION_TITLE, ['Cancel', 'Clear', 'Clear & Empty'])
        await ask.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(ask).toHaveCount(0)
        await expect(listItem(editor, 0).exprToggle).toHaveAttribute('aria-pressed', 'false')
        await expect(statTrigger(editor, 0)).toHaveText('Count')

        const added = await addStatEntry(page, editor)
        await page.keyboard.press('Escape')
        await expect(added).toBeHidden()
        await expect(statTrigger(editor, 1)).toHaveText('Sum (no field)')
        // The Add entry holds nothing of the user's, so {x} switches at once.
        await listItem(editor, 1).exprToggle.click()
        await expect(switchWarning(page)).toHaveCount(0)
        await expect(listItem(editor, 1).exprToggle).toHaveAttribute('aria-pressed', 'true')
        await setListItemExpression(page, editor, 1, 'no_stat_here')
        await listItem(editor, 1).exprToggle.click()
        const back = await expectSwitchWarning(page, TO_PLAIN_TITLE, ['Cancel', 'Clear'])
        await back.getByRole('button', { name: 'Clear', exact: true }).click()
        await expect(listItem(editor, 1).exprToggle).toHaveAttribute('aria-pressed', 'false')
        await expect(statTrigger(editor, 1), 'back from {x} it is the Add entry').toHaveText('Sum (no field)')

        const popover = await setStatEntry(page, editor, 1, { field: 'latency_ms' })
        await page.keyboard.press('Escape')
        await expect(popover).toBeHidden()
        await expect(statTrigger(editor, 1)).toHaveText('Sum of latency_ms')

        const third = await addStatEntry(page, editor)
        await page.keyboard.press('Escape')
        await expect(third).toBeHidden()
        await setListItemExpression(page, editor, 2, 'max_stat')
        await expect(listMoveUp(editor, 2)).toHaveAccessibleName('Move stat 3 up')
        await saveListEditor(editor)
        await expect(editPreview(sheet, 'stats')).toHaveValue(
          '[{"stat": "count"}, {"stat": "sum", "field": "latency_ms"}, {{ max_stat }}]',
        )
        await saveConfig(sheet)
      })

      await test.step('Stats: the null button on entry 2', async () => {
        const sheet = await openConfig(page, STATS_NULL)
        await nullItem(await openListEditor(page, sheet, 'stats'), 1)
        await expect(editPreview(sheet, 'stats')).toHaveValue('[{"stat": "count"}, null]')
        await saveConfig(sheet)
      })

      await test.step('the stored record rows and their {x} flags', async () => {
        await saveWorkbench(page)
        const nodes = await persistedNodes(page.request, testId)
        expect(nodes[FIELDS].config.values.fields).toEqual([
          { value: '@timestamp' },
          { value: 'service.name' },
          { value: 'latency_ms' },
          { value: 'extra_field' },
        ])
        expect(nodes[FIELDS].expressionFields).toEqual(['fields.3.value'])
        expect(nodes[FIELDS_NULL].config.values.fields).toEqual([{ value: '@timestamp' }, { value: null }])
        expect(nodes[STATS].config.values.stats).toEqual([
          { value: { stat: 'count' } },
          { value: { stat: 'sum', field: 'latency_ms' } },
          { value: 'max_stat' },
        ])
        expect(nodes[STATS].expressionFields).toEqual(['stats.2.value'])
        expect(nodes[STATS_NULL].config.values.stats).toEqual([{ value: { stat: 'count' } }, { value: null }])
      })

      await test.step('reopened, both editors read the stored rows back', async () => {
        let sheet = await openConfig(page, FIELDS)
        let editor = await openListEditor(page, sheet, 'fields')
        for (const [index, name] of ['@timestamp', 'service.name', 'latency_ms'].entries()) {
          await expect(listEntry(editor, index)).toHaveValue(name)
        }
        await expect(listItem(editor, 3).exprBox.locator('.cm-content')).toHaveText('extra_field')
        await closeValueEditor(page, editor)
        await closeConfig(sheet)

        sheet = await openConfig(page, STATS)
        editor = await openListEditor(page, sheet, 'stats')
        await expect(listItems(editor)).toHaveCount(3)
        await expect(statTrigger(editor, 0)).toHaveText('Count')
        await expect(statTrigger(editor, 1)).toHaveText('Sum of latency_ms')
        await expect(listItem(editor, 2).exprBox.locator('.cm-content')).toHaveText('max_stat')
        await closeValueEditor(page, editor)
        await closeConfig(sheet)
      })

      await test.step('the run: the chosen columns in order, the stats for the window; null entries end amber', async () => {
        const status = await startRun(page)
        await finishRun(page, status, `zz-11541-s5-os-done-${token}`, 180_000)
        const variables = await getSessionVariables(page, await getActiveSessionId(page))

        const rows = sessionTable(variables, 'fields_rows')
        expect(columnNames(rows), 'one column per row, the {x} row by its value').toEqual([
          '@timestamp',
          'service.name',
          'latency_ms',
          'user.id',
        ])
        const newestFirst = [...F_METRICS].sort((a, b) =>
          String(b['@timestamp']).localeCompare(String(a['@timestamp'])),
        )
        expect(column(rows, 'service.name')).toEqual(newestFirst.map((doc) => (doc.service as { name: string }).name))
        expect(column(rows, 'latency_ms').map(num)).toEqual(newestFirst.map((doc) => doc.latency_ms))
        expect(column(rows, 'user.id')).toEqual(newestFirst.map((doc) => (doc.user as { id: string }).id))
        expect(sessionValue(variables, 'fields_total')).toBe(10)
        await expectNodeStatus(page, FIELDS, 'success')

        const stats = sessionTable(variables, 'stats_rows')
        expect(columnNames(stats)).toEqual(['count', 'sum of latency_ms', 'max of latency_ms'])
        expect(stats.rows, 'one row for the whole window').toHaveLength(1)
        expect(['count', 'sum of latency_ms', 'max of latency_ms'].map((name) => num(column(stats, name)[0]))).toEqual([
          10, 1520, 250,
        ])
        await expectNodeStatus(page, STATS, 'success')

        for (const [id, prefix, message] of [
          [FIELDS_NULL, 'fnull', NULL_FIELD],
          [STATS_NULL, 'snull', NULL_STAT],
        ]) {
          expect(sessionValue(variables, `${prefix}_ok`)).toBe(false)
          expect(sessionValue(variables, `${prefix}_reason`)).toBe('Validation')
          expect(sessionValue(variables, `${prefix}_error`)).toBe(message)
          await expectNodeStatus(page, id, 'warning')
        }
      })
    })
  })
})
