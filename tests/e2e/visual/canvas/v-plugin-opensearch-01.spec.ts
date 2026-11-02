/**
 * V-PLUGIN-OPENSEARCH-01: OpenSearch config sheet
 * Design Decisions: OS-1, OS-2, OS-3, OS-4, OS-5, OS-6, OS-7, OS-8, OS-11, FIELD-2, FIELD-9, FIELD-10, SECFLD-1,
 *                   FIELDERR-1, FIELDERR-3
 * REQ: REQ-3.4.1.15, REQ-3.3.2.3, REQ-3.3.2.5
 *
 * Runs in the no-data project list: no OpenSearch service is contacted. Each test seeds its own
 * Test (POST /tests, or the admin bulk route for a block the server refuses) and afterAll deletes
 * it. Behavior is read back from the saved Test (GET /tests/{id}/workflow). Theme-agnostic DOM
 * assertions.
 *
 * Pass Criteria:
 * 1. Search on open, Cluster URL, Index pattern and Fields filled: the header carries the
 *    SearchCode glyph in purple, the title "OpenSearch - Edit Config" and Version 1.0.0; rows in
 *    order Cluster URL*, Index pattern*, From (`now-15m` in gray, clock glyph), To (`now` in gray),
 *    Query language (DQL), Query, Mode (Search), Fields (one line `["@timestamp", "log.level",
 *    "message"]`), Max results (10000 in gray), Timeout (300 in gray); then Sort, Authentication,
 *    TLS / Certificates, Advanced, Failure Handling and Secrets, all collapsed.
 * 2. Every row but Query language, Mode and On error carries the {} toggle; in the Fields editor
 *    each entry has its own.
 * 3. A blank block: the rows the server names as required are exactly Cluster URL and Index
 *    pattern, each flagged as the sheet opens; the note under the disabled Save reads "Save is
 *    disabled: the settings have errors"; the empty Cluster URL shows the italic gray hint
 *    `https://opensearch.internal:9200`.
 * 4. Mode Aggregate: Group by time (Every 1 minute; No, Every 10 seconds, Every 30 seconds,
 *    Every 1 minute, Every 5 minutes, Every 15 minutes, Every 1 hour), Group by field
 *    (hint No field), Top values (10 in gray) and Stats (its editor holds Count, Add stat) replace
 *    Fields, Max results and the Sort group; the outputs do not change. Back to Search, the Fields
 *    entries added in the Fields editor (Add field) are still there and are saved.
 * 5. Authentication open: Username, Password, API Key, Bearer Token, the last three with the
 *    lock glyph, and the footer line. Advanced open: Time field (`@timestamp` in gray), Connect
 *    timeout (30 in gray); `event.created` typed key by key into the not-set Time field replaces
 *    the gray default, shows reset and is saved. TLS / Certificates open: Verify Server Certificate (ticked), CA
 *    Certificate, Client Certificate, Client Key (lock glyph), and no toggle row.
 * 6. Amber notes: API Key "ApiKey abc" and Bearer Token "Bearer x", typed and not yet saved, each
 *    show two lines under the field, linked to it: first the note asking to remove the scheme word
 *    (OS-2), then `Secret value stays visible until you save the test.` (SECFLD-1); an http Cluster
 *    URL with CA Certificate filled shows "Not used: the Cluster URL is http" under CA Certificate. A block in a Wait Until retry lane with From now-15m shows no
 *    From note.
 * 7. The Cluster URL's Edit value sheet has no Format control.
 * 8. From picker, opened from From's expand: a dialog labeled From with the strip From mode
 *    (Absolute, Relative, Now); Relative shows Amount 15, minutes ago, Round to the minute
 *    unticked and now-15m; ticking Round shows now-15m/m and Save writes it (saved), the field
 *    reading `now-15m/m`; the typed 2026-09-25T10:42:05Z shows September 2026 with the 25th
 *    selected, Hour 10, Minute 42, Second 05 and the Date and time box, and Save writes it; Now
 *    shows now, and Esc closes the picker writing nothing; Now then Save writes now (saved).
 * 9. Row checks on From: 1790332925 shows the red epoch-seconds message and blocks Save;
 *    "yesterday" shows "From is not a time: use Absolute, Relative or Now"; a zone-less
 *    timestamp shows the muted "No zone given: read as UTC"; From after To shows the amber
 *    "From is later than To: the search can find nothing".
 * 10. Stat popover in the Stats editor: the second entry reads "95th percentile of latency_ms",
 *    cut by the entry width; its popover (Stat 2) holds Stat Percentile, Percent 95, Field
 *    latency_ms and the column line "percentile 95 of latency_ms"; Custom (JSON) shows Aggregation
 *    with Edit JSON and Column name with the placeholder "custom 2", column line "custom 2"; Add
 *    stat appends an entry (saved), opens its popover with focus on Stat, and it reads "Sum (no
 *    field)" with the column line "Pick a field".
 * 11. Outputs read Success (Boolean), Results (Table), Total results (Integer); Error and Reason
 *    (String) join only under On error = Record and continue.
 * 12. Query language Query DSL: the Query row opens the editor in Query DSL (Format Query DSL,
 *    DQL before) and the text typed under DQL is kept and saved.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  closeConfig,
  expandGroup,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../../functional/file-picker/picker'
import { importExpectingErrors } from '../../helpers/fixture-import'
import {
  addFieldEntry,
  addStatEntry,
  cancelTimePicker,
  checkbox,
  closeTimePicker,
  closeValueEditor,
  editPreview,
  elementColor,
  enumTrigger,
  expectLayout,
  expectOnlyRequiredFlags,
  expectOptions,
  expectOutputs,
  exprToggle,
  groupHeader,
  listAddButton,
  listEntry,
  listItems,
  listPositions,
  numberInput,
  openFieldEditor,
  openListEditor,
  openStatEntry,
  openTimePicker,
  outputRow,
  paramRow,
  pickEnum,
  pickTimeTab,
  requiredStar,
  resolvedColor,
  rowAlerts,
  rowError,
  rowLabel,
  rowWarning,
  saveButton,
  saveListEditor,
  saveTimePicker,
  secretsTrigger,
  setAbsoluteTime,
  setRelativeTime,
  setStatEntry,
  settingsNote,
  statColumnLine,
  statFieldBox,
  statTrigger,
  suggestInput,
  timeDateBox,
  timeResultLine,
  timeTabStrip,
  timeTrigger,
  typeFieldText,
  typeSuggestText,
} from '../../helpers/config-sheet'
import { listItem } from '../../helpers/entry-editors'
import { resetButton } from '../../helpers/value-field'
import {
  OPENSEARCH_NODE_ID,
  OPENSEARCH_SHEET_TITLE,
  SETTINGS_NOTE,
  deleteOpenSearchTests,
  openIncompleteOpenSearchSheet,
  openOpenSearchSheet,
  openSearchNode,
  openSheetOf,
  openValidOpenSearchSheet,
  seedTest,
} from './opensearch-sheet-seed'

// --- expected sheet content, verbatim from the shipped schema ---------------

const CLUSTER_URL = 'https://opensearch.internal:9200'
const INDEX = 'filebeat-*'
const QUERY = 'log.level:ERROR or message:"Login failed"'
const WIREFRAME_FIELDS = ['@timestamp', 'log.level', 'message']
const fieldList = (names: string[]) => names.map((value) => ({ value }))

const SEARCH_VALUES = {
  url: CLUSTER_URL,
  index: INDEX,
  query: QUERY,
  fields: fieldList(WIREFRAME_FIELDS),
}

const LABELS: Record<string, { label: string; type: string }> = {
  url: { label: 'Cluster URL', type: 'String' },
  index: { label: 'Index pattern', type: 'String' },
  from: { label: 'From', type: 'String' },
  to: { label: 'To', type: 'String' },
  query_language: { label: 'Query language', type: 'String' },
  query: { label: 'Query', type: 'String' },
  mode: { label: 'Mode', type: 'String' },
  fields: { label: 'Fields', type: 'Array' },
  max_results: { label: 'Max results', type: 'Integer' },
  group_by_time: { label: 'Group by time', type: 'String' },
  group_by_field: { label: 'Group by field', type: 'String' },
  top_values: { label: 'Top values', type: 'Integer' },
  stats: { label: 'Stats', type: 'Array' },
  timeout: { label: 'Timeout', type: 'Integer' },
  sort_by: { label: 'Sort by', type: 'String' },
  order: { label: 'Order', type: 'String' },
  username: { label: 'Username', type: 'String' },
  password: { label: 'Password', type: 'String' },
  api_key: { label: 'API Key', type: 'String' },
  bearer_token: { label: 'Bearer Token', type: 'String' },
  verify_ssl: { label: 'Verify Server Certificate', type: 'Boolean' },
  ca_cert: { label: 'CA Certificate', type: 'String' },
  client_cert: { label: 'Client Certificate', type: 'String' },
  client_key: { label: 'Client Key', type: 'String' },
  time_field: { label: 'Time field', type: 'String' },
  connect_timeout: { label: 'Connect timeout', type: 'Integer' },
  on_error: { label: 'On error', type: 'String' },
}

const HEAD = ['url', 'index', 'from', 'to', 'query_language', 'query', 'mode']
const SEARCH_ROWS = [...HEAD, 'fields', 'max_results', 'timeout']
const AGGREGATE_ROWS = [...HEAD, 'group_by_time', 'group_by_field', 'top_values', 'stats', 'timeout']
const TLS_GROUP = 'TLS / Certificates'
const AFTER_SORT = ['[Authentication]', `[${TLS_GROUP}]`, '[Advanced]', '[Failure Handling]', '[Secrets]']
const SEARCH_TAIL = ['[Sort]', ...AFTER_SORT]
const AUTH_ROWS = ['username', 'password', 'api_key', 'bearer_token']
const TLS_ROWS = ['verify_ssl', 'ca_cert', 'client_cert', 'client_key']
const ADVANCED_ROWS = ['time_field', 'connect_timeout']
const SORT_ROWS = ['sort_by', 'order']
/** OS-1, OS-5: the rows that reveal other rows take no expression; On error is the shared row. */
const NO_TOGGLE = new Set(['query_language', 'mode', 'on_error'])
const SECRET_ROWS = new Set(['password', 'api_key', 'bearer_token', 'client_key'])

const AUTH_FOOTER =
  'How WAVE identifies itself to the cluster: a username and password, an API key, a bearer token, or none. A client certificate under TLS / Certificates can go with any of them.'
const GROUP_BY_TIME = [
  'No',
  'Every 10 seconds',
  'Every 30 seconds',
  'Every 1 minute',
  'Every 5 minutes',
  'Every 15 minutes',
  'Every 1 hour',
]

const OUTPUTS: Record<string, { label: string; type: string }> = {
  success: { label: 'Success', type: 'Boolean' },
  results: { label: 'Results', type: 'Table' },
  total_results: { label: 'Total results', type: 'Integer' },
  error: { label: 'Error', type: 'String' },
  reason: { label: 'Reason', type: 'String' },
}
const CORE_OUTPUTS = ['success', 'results', 'total_results']

const EPOCH_SECONDS_ERROR = 'From reads as epoch seconds: for seconds, multiply by 1000'
const NOT_A_TIME_ERROR = 'From is not a time: use Absolute, Relative or Now'
const NO_ZONE_HINT = 'No zone given: read as UTC'
const FROM_AFTER_TO = 'From is later than To: the search can find nothing'
const TYPED_TIME = '2026-09-25T10:42:05Z'
const UNSAVED_SECRET = 'Secret value stays visible until you save the test.'

// --- locators and small helpers ---------------------------------------------

const created: string[] = []


/** Label, Type text and required marker of each row. */
async function expectRowHeads(sheet: Locator, names: string[], required: string[] = []): Promise<void> {
  for (const name of names) {
    expect(await rowLabel(sheet, name), name).toBe(LABELS[name].label)
    await expect(paramRow(sheet, name).locator('td:nth-child(3)'), name).toHaveText(LABELS[name].type, {
      useInnerText: true,
    })
    await expect(requiredStar(sheet, name), `${name} required marker`).toHaveCount(required.includes(name) ? 1 : 0)
  }
}

/** Every input row on the sheet carries the {} toggle unless it reveals rows or is On error. */
async function expectToggles(sheet: Locator): Promise<void> {
  const names = await sheet
    .locator('[data-testid^="param-row-"]')
    .evaluateAll((rows) => rows.map((row) => (row.getAttribute('data-testid') ?? '').replace('param-row-', '')))
  expect(names.length, 'rows to check').toBeGreaterThan(0)
  for (const name of names) {
    await expect(exprToggle(sheet, name), `${name} expression toggle`).toHaveCount(NO_TOGGLE.has(name) ? 0 : 1)
  }
}

async function expectLock(sheet: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    await expect(paramRow(sheet, name).locator('svg.lucide-lock'), `${name} lock glyph`).toHaveCount(
      SECRET_ROWS.has(name) ? 1 : 0,
    )
  }
}

/** The Fields editor's rows (FIELD-10): one field box each, numbered from 1. */
async function expectFieldEntries(editor: Locator, values: string[]): Promise<void> {
  await expect(listItems(editor)).toHaveCount(values.length)
  expect(await listPositions(editor)).toEqual(values.map((_, index) => String(index + 1)))
  for (const [index, value] of values.entries()) {
    await expect(listEntry(editor, index), `Fields entry ${index + 1}`).toHaveValue(value)
  }
}

/** The one-line list a Fields row shows. */
const fieldsLine = (names: string[]) => `[${names.map((name) => JSON.stringify(name)).join(', ')}]`

async function expectOutputRows(sheet: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    const row = outputRow(sheet, name)
    await expect(row.locator('td:nth-child(2)'), name).toHaveText(OUTPUTS[name].label)
    await expect(row.locator('td:nth-child(3)'), name).toHaveText(OUTPUTS[name].type, { useInnerText: true })
  }
}

/** Apply the sheet, persist the Test, and return the block's saved node data. */
async function saveAndRead(page: Page, sheet: Locator, testId: string): Promise<Record<string, any>> {
  await saveConfig(sheet)
  await saveWorkbench(page)
  return (await persistedNodes(page.request, testId))[OPENSEARCH_NODE_ID]
}

async function pickKind(page: Page, editor: Locator, kind: 'Literal' | 'Template'): Promise<void> {
  const dropdown = editor.locator('[data-testid="kind-dropdown"]')
  await dropdown.click()
  await page.getByRole('option', { name: kind, exact: true }).click()
  await expect(dropdown).toHaveText(kind)
}

/** A field shows its gray default as real text in Text Muted, with no reset icon (FIELD-2). */
async function expectGrayDefault(page: Page, sheet: Locator, name: string, shown: string): Promise<void> {
  const box = name === 'index' || name === 'time_field' || name === 'group_by_field' || name === 'sort_by'
    ? suggestInput(sheet, name)
    : editPreview(sheet, name)
  await expect(box, `${name} shows its default`).toHaveValue(shown)
  expect(await elementColor(box, 'color'), `${name}: the default is gray`).toBe(
    await resolvedColor(page, 'var(--color-text-muted)'),
  )
  await expect(resetButton(sheet, name), `${name}: no reset while not set`).toHaveCount(0)
}

// --- the Wait Until retry lane (criterion 6) ----------------------------------

const WAIT_NODE_ID = '4d0f2cb4-2e89-40a4-8404-6e75d0cac421'

function retryLaneFixture(values: Record<string, unknown>): Record<string, unknown> {
  const wait = {
    id: WAIT_NODE_ID,
    type: 'workflowNode',
    position: { x: 120, y: 60 },
    data: {
      label: 'Wait Until',
      elementType: 'wait-until',
      nodeType: 'control',
      category: 'timing',
      version: '1.0.0',
      description: '',
      expressionFields: [],
      templateFields: [],
      config: {
        values: {
          conditions: [
            {
              type: 'literal',
              variable: 'status',
              value_type: 'integer',
              operator: 'equals',
              reference_value: '200',
              reference_is_expression: false,
              id: '21582daf-bcfc-49f3-a740-bcd0f70cd807',
            },
          ],
          timeout: 30000,
          check_interval: 300,
          message: 'status never reached 200',
          mode: 'retry',
          fail_current_scope: false,
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 160, height: 62 },
  }
  return {
    name: 'V-PLUGIN-OPENSEARCH-01 retry lane',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [wait, openSearchNode(OPENSEARCH_NODE_ID, values, {}, { x: -60, y: 220 })],
      edges: [
        { id: '53315018-c085-4aad-bdb2-23e1b0ce190f', source: 'start-node', target: WAIT_NODE_ID },
        {
          id: '4f11268c-5849-48e1-ac5b-1b4ecba13a97',
          source: WAIT_NODE_ID,
          sourceHandle: 'retry',
          target: OPENSEARCH_NODE_ID,
        },
      ],
    },
    variables: { status: { value: 0, type: 'integer', scope: 'test' } },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

// --- the four From checks (criterion 9), one block each -----------------------

const FROM_CHECKS = {
  epoch: { id: '3fc6eb1d-14f0-47fb-9deb-f51c3cbf1fd4', values: { from: '1790332925' } },
  word: { id: '3e5b41ea-09c3-4545-b74b-5360d510a17b', values: { from: 'yesterday' } },
  zoneless: { id: '9fe10be1-9a43-402e-9dc9-374a0118cc2c', values: { from: '2026-09-25T10:42:05' } },
  after: {
    id: 'a10aaf0c-b3eb-4673-b490-a8a0e41fcd05',
    values: { from: '2026-09-25T11:00:00Z', to: '2026-09-25T10:00:00Z' },
  },
}

function fromChecksFixture(): Record<string, unknown> {
  const checks = Object.values(FROM_CHECKS)
  const edgeIds = [
    '376b9a50-6f07-41ac-b8dc-8b0ebccadc06',
    '76510d3d-21e0-4a30-b0ac-82c8b3e149dd',
    '23a52231-5b2b-489f-9aab-14811e483087',
    '68d741a8-8b55-4546-858c-5d18bb186708',
  ]
  const sources = ['start-node', ...checks.map((check) => check.id)]
  return {
    name: 'V-PLUGIN-OPENSEARCH-01 from checks',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: checks.map((check, index) =>
        openSearchNode(check.id, { url: CLUSTER_URL, index: INDEX, ...check.values }, {}, { x: -75, y: 100 + index * 140 }),
      ),
      edges: checks.map((check, index) => ({ id: edgeIds[index], source: sources[index], target: check.id })),
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-OPENSEARCH-01: OpenSearch config sheet', () => {
  test.afterAll(async ({ request }) => {
    await deleteOpenSearchTests(request, created)
  })

  test('V-PLUGIN-OPENSEARCH-01 search on open: the rows in order, their values, six sections collapsed', async ({
    page,
  }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 search', SEARCH_VALUES, {
      templateFields: ['query'],
    })
    created.push(testId)

    const heading = sheet.getByRole('heading', { name: OPENSEARCH_SHEET_TITLE })
    const glyph = heading.locator('svg.lucide-search-code')
    await expect(glyph).toHaveCount(1)
    await expect(glyph).toHaveClass(/\btext-purple-500\b/)
    await expect(sheet.locator('[data-testid="version-selector"]')).toContainText('1.0.0')

    // OS-1, OS-6: the connection, the window, the query, then the Search rows and Timeout.
    await expectLayout(sheet, [...SEARCH_ROWS, ...SEARCH_TAIL], 'search on open')
    await expectRowHeads(sheet, SEARCH_ROWS, ['url', 'index'])

    await expect(editPreview(sheet, 'url')).toHaveValue(CLUSTER_URL)
    await expect(suggestInput(sheet, 'index')).toHaveValue(INDEX)
    // OS-4, FIELD-9: the window as written, not set so in gray, each with the clock glyph.
    await expectGrayDefault(page, sheet, 'from', 'now-15m')
    await expectGrayDefault(page, sheet, 'to', 'now')
    for (const name of ['from', 'to']) {
      await expect(paramRow(sheet, name).locator('svg.lucide-clock'), `${name} clock glyph`).toHaveCount(1)
      await expect(timeTrigger(sheet, name), `${name} opens its picker from expand`).toHaveAccessibleName(
        `Open editor for ${LABELS[name].label}`,
      )
    }
    await expect(enumTrigger(sheet, 'query_language')).toHaveText('DQL')
    await expect(editPreview(sheet, 'query')).toHaveValue(QUERY)
    await expect(enumTrigger(sheet, 'mode')).toHaveText('Search')
    // FIELD-10: Fields is a one-line list field whose expand opens the Fields editor.
    await expect(editPreview(sheet, 'fields')).toHaveValue(fieldsLine(WIREFRAME_FIELDS))
    for (const [name, shown] of [
      ['max_results', '10000'],
      ['timeout', '300'],
    ]) {
      await expect(numberInput(sheet, name), `${name} default`).toHaveValue(shown)
      expect(await elementColor(numberInput(sheet, name), 'color'), `${name}: the default is gray`).toBe(
        await resolvedColor(page, 'var(--color-text-muted)'),
      )
    }

    for (const group of ['Sort', 'Authentication', TLS_GROUP, 'Advanced', 'Failure Handling']) {
      await expect(groupHeader(sheet, group), `${group} collapsed`).toHaveAttribute('aria-expanded', 'false')
    }
    await expect(secretsTrigger(sheet)).toHaveAttribute('aria-expanded', 'false')
    await expect(rowAlerts(sheet), 'a filled block opens with no row message').toHaveCount(0)
  })

  test('V-PLUGIN-OPENSEARCH-01 toggles: every row but Query language, Mode and On error, and each Fields entry', async ({
    page,
  }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 toggles', SEARCH_VALUES)
    created.push(testId)

    for (const group of ['Sort', 'Authentication', TLS_GROUP, 'Advanced', 'Failure Handling']) {
      await expandGroup(sheet, group)
    }
    await expectLayout(
      sheet,
      [
        ...SEARCH_ROWS,
        '[Sort]',
        ...SORT_ROWS,
        '[Authentication]',
        ...AUTH_ROWS,
        `[${TLS_GROUP}]`,
        ...TLS_ROWS,
        '[Advanced]',
        ...ADVANCED_ROWS,
        '[Failure Handling]',
        'on_error',
        '[Secrets]',
      ],
      'every group open',
    )
    await expectToggles(sheet)
    // OS-6, FIELD-10: each Fields entry is a literal or an expression of its own, in the Fields editor.
    const editor = await openListEditor(page, sheet, 'fields')
    for (const index of WIREFRAME_FIELDS.keys()) {
      await expect(listItem(editor, index).exprToggle, `Fields entry ${index + 1} {x}`).toHaveCount(1)
    }
    await closeValueEditor(page, editor)
  })

  test('V-PLUGIN-OPENSEARCH-01 blank block: exactly Cluster URL and Index pattern are required and flagged', async ({
    page,
  }) => {
    const { testId, sheet } = await openIncompleteOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 blank', {}, [
      'url',
      'index',
    ])
    created.push(testId)

    // FIELDERR-1, FIELDERR-3: both empty required rows are flagged at once; the note stays generic.
    for (const name of ['url', 'index']) await expect(rowError(sheet, name), `${name} flagged on open`).toHaveCount(1)
    await expect(rowAlerts(sheet)).toHaveCount(2)
    await expectOnlyRequiredFlags(sheet)
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
    await expect(saveButton(sheet)).toBeDisabled()

    // An empty field with no default shows its hint, italic and in Text Muted.
    const url = editPreview(sheet, 'url')
    await expect(url).toHaveValue('')
    await expect(url).toHaveAttribute('placeholder', CLUSTER_URL)
    const hint = await url.evaluate((el) => {
      const style = getComputedStyle(el, '::placeholder')
      return { fontStyle: style.fontStyle, color: style.color }
    })
    expect(hint.fontStyle, 'the hint is italic').toBe('italic')
    expect(await resolvedColor(page, hint.color), 'the hint is gray').toBe(
      await resolvedColor(page, 'var(--color-text-muted)'),
    )
  })

  test('V-PLUGIN-OPENSEARCH-01 aggregate: the Aggregate rows replace the Search rows, Fields come back', async ({
    page,
  }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 aggregate', {
      url: CLUSTER_URL,
      index: INDEX,
    })
    created.push(testId)

    // OS-6: Fields opens with @timestamp; the other two entries are added in the Fields editor.
    await expect(editPreview(sheet, 'fields')).toHaveValue(fieldsLine(['@timestamp']))
    let editor = await openListEditor(page, sheet, 'fields')
    await expectFieldEntries(editor, ['@timestamp'])
    await addFieldEntry(editor, 'log.level')
    await addFieldEntry(editor, 'message')
    await expectFieldEntries(editor, WIREFRAME_FIELDS)
    await saveListEditor(editor)
    await expect(editPreview(sheet, 'fields')).toHaveValue(fieldsLine(WIREFRAME_FIELDS))
    await expectOutputs(sheet, CORE_OUTPUTS, 'search outputs')

    // OS-1, OS-7: Mode reveals only its own rows; the Sort group belongs to Search.
    await pickEnum(page, sheet, 'mode', 'Aggregate')
    await expectLayout(sheet, [...AGGREGATE_ROWS, ...AFTER_SORT], 'aggregate')
    await expectRowHeads(sheet, AGGREGATE_ROWS, ['url', 'index'])
    await expect(enumTrigger(sheet, 'group_by_time')).toHaveText('Every 1 minute')
    await expectOptions(page, sheet, 'group_by_time', GROUP_BY_TIME)
    await expect(suggestInput(sheet, 'group_by_field')).toHaveAttribute('placeholder', 'No field')
    await expect(suggestInput(sheet, 'group_by_field')).toHaveValue('')
    await expect(numberInput(sheet, 'top_values')).toHaveValue('10')
    await expect(editPreview(sheet, 'stats')).toHaveValue('[{"stat": "count"}]')
    editor = await openListEditor(page, sheet, 'stats')
    await expect(listItems(editor)).toHaveCount(1)
    await expect(statTrigger(editor, 0)).toHaveText('Count')
    await expect(statTrigger(editor, 0).locator('svg.lucide-sigma')).toHaveCount(1)
    await expect(listAddButton(editor)).toHaveText('Add stat')
    await closeValueEditor(page, editor)
    await expect(groupHeader(sheet, 'Sort')).toHaveCount(0)
    await expectToggles(sheet)
    // OS-8: the outputs are the same in both modes.
    await expectOutputs(sheet, CORE_OUTPUTS, 'aggregate outputs')

    await pickEnum(page, sheet, 'mode', 'Search')
    await expectLayout(sheet, [...SEARCH_ROWS, ...SEARCH_TAIL], 'back to search')
    await expect(editPreview(sheet, 'fields')).toHaveValue(fieldsLine(WIREFRAME_FIELDS))

    const saved = await saveAndRead(page, sheet, testId)
    expect(saved.config.values.mode ?? 'search', 'saved Mode').toBe('search')
    expect(saved.config.values.fields, 'the typed Fields entries are saved').toEqual(fieldList(WIREFRAME_FIELDS))
  })

  test('V-PLUGIN-OPENSEARCH-01 groups: Authentication with its footer, Advanced, TLS with no toggle row', async ({
    page,
  }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 groups', {
      ...SEARCH_VALUES,
      username: 'wave-qa',
    })
    created.push(testId)

    // OS-2: modeless Authentication; three sealed secrets and the footer line.
    await expandGroup(sheet, 'Authentication')
    await expectLayout(
      sheet,
      [...SEARCH_ROWS, '[Sort]', '[Authentication]', ...AUTH_ROWS, `[${TLS_GROUP}]`, '[Advanced]', '[Failure Handling]', '[Secrets]'],
      'Authentication open',
    )
    await expectRowHeads(sheet, AUTH_ROWS)
    await expectLock(sheet, AUTH_ROWS)
    await expect(editPreview(sheet, 'username')).toHaveValue('wave-qa')
    await expect(sheet.locator('[data-testid="group-footer-Authentication"]')).toHaveText(AUTH_FOOTER)

    // OS-13: the Time field is the one value field, its default in gray while not set.
    await expandGroup(sheet, 'Advanced')
    await expectRowHeads(sheet, ADVANCED_ROWS)
    await expectGrayDefault(page, sheet, 'time_field', '@timestamp')
    await expect(numberInput(sheet, 'connect_timeout')).toHaveValue('30')
    // The gray default takes no fill(): typed key by key, the first key replaces it whole (FIELD-2).
    const timeField = suggestInput(sheet, 'time_field')
    await typeSuggestText(timeField, 'event.created')
    expect(await elementColor(timeField, 'color'), 'a typed value is not gray').not.toBe(
      await resolvedColor(page, 'var(--color-text-muted)'),
    )
    await expect(resetButton(sheet, 'time_field'), 'a set field with a default shows reset').toHaveCount(1)

    // OS-2: an https URL uses TLS, so the group holds no TLS switch.
    await expandGroup(sheet, TLS_GROUP)
    await expectLayout(
      sheet,
      [
        ...SEARCH_ROWS,
        '[Sort]',
        '[Authentication]',
        ...AUTH_ROWS,
        `[${TLS_GROUP}]`,
        ...TLS_ROWS,
        '[Advanced]',
        ...ADVANCED_ROWS,
        '[Failure Handling]',
        '[Secrets]',
      ],
      'Authentication, TLS and Advanced open',
    )
    await expectRowHeads(sheet, TLS_ROWS)
    await expectLock(sheet, TLS_ROWS)
    await expect(checkbox(sheet, 'verify_ssl')).toHaveAttribute('data-state', 'checked')
    await expect(paramRow(sheet, 'tls'), 'no toggle row').toHaveCount(0)

    const saved = await saveAndRead(page, sheet, testId)
    expect(saved.config.values.time_field, 'the Time field typed key by key is saved').toBe('event.created')
  })

  test('V-PLUGIN-OPENSEARCH-01 amber notes: scheme words, certificates on http', async ({ page }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 notes', {
      url: 'http://opensearch.internal:9200',
      index: INDEX,
      ca_cert: '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUWAVE\n-----END CERTIFICATE-----',
    })
    created.push(testId)

    // OS-2, SECFLD-1: the scheme-word note first, then the line saying the typed secret is plain text until saved.
    await expandGroup(sheet, 'Authentication')
    await typeFieldText(sheet, 'api_key', 'ApiKey abc')
    await expect(rowWarning(sheet, 'api_key').locator('p')).toHaveText([
      'Remove "ApiKey " at the start: WAVE adds it',
      UNSAVED_SECRET,
    ])
    await typeFieldText(sheet, 'bearer_token', 'Bearer x')
    await expect(rowWarning(sheet, 'bearer_token').locator('p')).toHaveText([
      'Remove "Bearer " at the start: WAVE adds it',
      UNSAVED_SECRET,
    ])
    for (const name of ['api_key', 'bearer_token']) {
      const lines = await rowWarning(sheet, name).locator('p').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))
      expect(lines[1].top, `${name}: the secret line sits under the note`).toBeGreaterThanOrEqual(lines[0].bottom - 1)
      const warningId = await rowWarning(sheet, name).getAttribute('id')
      const describedBy = (await editPreview(sheet, name).getAttribute('aria-describedby')) ?? ''
      expect(describedBy.split(/\s+/), `${name}: both lines describe the field`).toContain(warningId)
    }

    // OS-2: TLS settings do nothing on an http URL.
    await expandGroup(sheet, TLS_GROUP)
    await expect(rowWarning(sheet, 'ca_cert')).toHaveText('Not used: the Cluster URL is http')
    for (const name of ['verify_ssl', 'client_cert', 'client_key']) {
      await expect(rowWarning(sheet, name), `${name} is not filled`).toHaveCount(0)
    }
    for (const name of ['api_key', 'bearer_token', 'ca_cert']) {
      await expect(rowWarning(sheet, name), `${name} note is amber`).toHaveClass(/\btext-warning\b/)
    }
    await expect(rowAlerts(sheet), 'an amber note never blocks Save').toHaveCount(0)
    await expect(settingsNote(sheet)).toHaveCount(0)
    await expect(saveButton(sheet)).toBeEnabled()
  })

  test('V-PLUGIN-OPENSEARCH-01 retry lane: a relative From inside a Wait Until retry lane has no note', async ({
    page,
  }) => {
    const testId = await seedTest(page.request, retryLaneFixture({ url: CLUSTER_URL, index: INDEX, from: 'now-15m' }))
    created.push(testId)
    const sheet = await openOpenSearchSheet(page, testId)

    await expect(editPreview(sheet, 'from')).toHaveValue('now-15m')
    await expect(rowWarning(sheet, 'from')).toHaveCount(0)
    await expect(rowError(sheet, 'from')).toHaveCount(0)
    await expect(rowAlerts(sheet)).toHaveCount(0)
  })

  test('V-PLUGIN-OPENSEARCH-01 Cluster URL editor: plain text, no Format control', async ({ page }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 url editor', SEARCH_VALUES)
    created.push(testId)

    const editor = await openFieldEditor(page, sheet, 'url')
    // The Kind picker proves the footer rendered before the absence is read.
    await expect(editor.locator('[data-testid="kind-dropdown"]')).toBeVisible()
    await expect(editor.locator('[data-testid="format-dropdown"]')).toHaveCount(0)
    await expect(editor.locator('.cm-content').first()).toHaveText(CLUSTER_URL)
    await closeValueEditor(page, editor)
  })

  test('V-PLUGIN-OPENSEARCH-01 From picker: Relative, Round, Absolute, Now, Esc writes nothing', async ({ page }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 from', {
      url: CLUSTER_URL,
      index: INDEX,
    })
    created.push(testId)

    // OS-4, FIELD-9: a not-set From opens on its default, now-15m, on Relative, writing nothing.
    const popover = await openTimePicker(page, sheet, 'from')
    const strip = timeTabStrip(popover, 'From')
    await expect(strip.getByRole('button')).toHaveText(['Absolute', 'Relative', 'Now'])
    await expect(strip.getByRole('button', { name: 'Relative' })).toHaveAttribute('aria-pressed', 'true')
    await expect(popover.getByRole('textbox', { name: 'Amount' })).toHaveValue('15')
    await expect(popover.getByRole('combobox', { name: 'Unit' })).toHaveText('minutes ago')
    const round = popover.getByRole('checkbox', { name: 'Round to the minute', exact: true })
    await expect(round).toHaveAttribute('data-state', 'unchecked')
    await expect(timeResultLine(popover)).toHaveText('now-15m')

    await setRelativeTime(page, sheet, 'from', { round: true })
    await expect(timeResultLine(popover)).toHaveText('now-15m/m')
    await expect(editPreview(sheet, 'from'), 'the picker writes nothing before Save').toHaveValue('now-15m')
    await saveTimePicker(popover)
    await expect(editPreview(sheet, 'from')).toHaveValue('now-15m/m')
    await expect(resetButton(sheet, 'from'), 'a set From that has a default shows reset').toHaveCount(1)

    let saved = await saveAndRead(page, sheet, testId)
    expect(saved.config.values.from, 'Round writes now-15m/m').toBe('now-15m/m')

    // OS-4: a typed ISO timestamp drives the calendar and the three time selects.
    let reopened = await openSheetOf(page)
    const absolute = await setAbsoluteTime(page, reopened, 'from', TYPED_TIME)
    await expect(timeTabStrip(absolute, 'From').getByRole('button', { name: 'Absolute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(absolute.getByRole('grid', { name: 'September 2026' })).toBeVisible()
    const selectedDay = absolute.locator('td[data-selected="true"]')
    await expect(selectedDay).toHaveCount(1)
    await expect(selectedDay).toHaveAttribute('data-day', '2026-09-25')
    await expect(absolute.getByRole('combobox', { name: 'Hour' })).toHaveValue('10')
    await expect(absolute.getByRole('combobox', { name: 'Minute' })).toHaveValue('42')
    await expect(absolute.getByRole('combobox', { name: 'Second' })).toHaveValue('05')
    await expect(timeDateBox(absolute)).toHaveValue(TYPED_TIME)
    await saveTimePicker(absolute)
    await expect(editPreview(reopened, 'from'), 'the field shows the time as written').toHaveValue(TYPED_TIME)

    // Esc closes the picker and its draft goes; focus is back on the expand.
    const now = await pickTimeTab(page, reopened, 'from', 'Now')
    await expect(timeResultLine(now)).toHaveText('now')
    await closeTimePicker(page, now)
    await expect(timeTrigger(reopened, 'from')).toBeFocused()
    await expect(editPreview(reopened, 'from'), 'Esc writes nothing').toHaveValue(TYPED_TIME)
    // Cancel discards the same way.
    const canceled = await pickTimeTab(page, reopened, 'from', 'Now')
    await cancelTimePicker(canceled)
    await expect(editPreview(reopened, 'from'), 'Cancel writes nothing').toHaveValue(TYPED_TIME)

    await saveTimePicker(await pickTimeTab(page, reopened, 'from', 'Now'))
    await expect(editPreview(reopened, 'from')).toHaveValue('now')

    saved = await saveAndRead(page, reopened, testId)
    expect(saved.config.values.from, 'Now writes now').toBe('now')
    reopened = await openSheetOf(page)
    await expect(editPreview(reopened, 'from')).toHaveValue('now')
  })

  test('V-PLUGIN-OPENSEARCH-01 From checks: epoch seconds, not a time, no zone, later than To', async ({ page }) => {
    const imported = await importExpectingErrors(page, fromChecksFixture())
    created.push(imported.testId)

    // OS-4: epoch seconds are refused in red and block Save.
    let sheet = await openSheetOf(page, FROM_CHECKS.epoch.id)
    await expect(rowError(sheet, 'from')).toHaveText(EPOCH_SECONDS_ERROR)
    await expect(rowError(sheet, 'from')).toHaveClass(/\btext-destructive\b/)
    await expect(saveButton(sheet)).toBeDisabled()
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
    await closeConfig(sheet)

    sheet = await openSheetOf(page, FROM_CHECKS.word.id)
    await expect(rowError(sheet, 'from')).toHaveText(NOT_A_TIME_ERROR)
    await expect(saveButton(sheet)).toBeDisabled()
    await closeConfig(sheet)

    // OS-4: a zone-less timestamp is UTC, said in a muted line that blocks nothing.
    sheet = await openSheetOf(page, FROM_CHECKS.zoneless.id)
    await expect(editPreview(sheet, 'from')).toHaveValue('2026-09-25T10:42:05')
    const hint = paramRow(sheet, 'from').getByText(NO_ZONE_HINT, { exact: true })
    await expect(hint).toBeVisible()
    await expect(hint).toHaveClass(/\btext-muted-foreground\b/)
    await expect(rowError(sheet, 'from')).toHaveCount(0)
    await expect(rowWarning(sheet, 'from')).toHaveCount(0)
    await expect(rowAlerts(sheet)).toHaveCount(0)
    await closeConfig(sheet)

    sheet = await openSheetOf(page, FROM_CHECKS.after.id)
    await expect(rowWarning(sheet, 'from')).toHaveText(FROM_AFTER_TO)
    await expect(rowWarning(sheet, 'from')).toHaveClass(/\btext-warning\b/)
    await expect(rowAlerts(sheet)).toHaveCount(0)
    await expect(settingsNote(sheet)).toHaveCount(0)
    await closeConfig(sheet)
  })

  test('V-PLUGIN-OPENSEARCH-01 stat popover: Percentile, Custom (JSON), Add stat', async ({ page }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 stats', {
      url: CLUSTER_URL,
      index: INDEX,
      mode: 'aggregate',
      stats: [{ value: { stat: 'count' } }, { value: { stat: 'percentile', field: 'latency_ms', percent: 95 } }],
    })
    created.push(testId)

    // OS-7, FIELD-10: each entry reads in words on one line in the Stats editor, cut by the entry width.
    const editor = await openListEditor(page, sheet, 'stats')
    await expect(statTrigger(editor, 0)).toHaveText('Count')
    const second = statTrigger(editor, 1)
    await expect(second).toHaveText('95th percentile of latency_ms')
    const words = await second.locator('span').evaluate((span) => {
      const style = getComputedStyle(span)
      return { overflow: style.textOverflow, wrap: style.whiteSpace }
    })
    expect(words, 'the entry never wraps').toEqual({ overflow: 'ellipsis', wrap: 'nowrap' })

    const popover = await openStatEntry(page, editor, 1)
    await expect(popover.getByRole('combobox', { name: 'Stat', exact: true })).toHaveText('Percentile')
    await expect(popover.locator('[data-testid="stat-percent"]')).toHaveValue('95')
    await expect(statFieldBox(popover)).toHaveValue('latency_ms')
    await expect(statColumnLine(popover)).toHaveText('percentile 95 of latency_ms')

    // OS-7: Custom (JSON) takes an aggregation and a column name instead of Percent and Field.
    await setStatEntry(page, editor, 1, { stat: 'Custom (JSON)' })
    await expect(popover.getByText('Aggregation', { exact: true })).toBeVisible()
    await expect(popover.getByRole('button', { name: 'Edit JSON' })).toBeVisible()
    const columnName = popover.getByRole('textbox', { name: 'Column name', exact: true })
    await expect(columnName).toHaveAttribute('placeholder', 'custom 2')
    await expect(columnName).toHaveValue('')
    await expect(statColumnLine(popover)).toHaveText('custom 2')
    await expect(popover.locator('[data-testid="stat-percent"]')).toHaveCount(0)
    await expect(statFieldBox(popover)).toHaveCount(0)
    await expect(second).toHaveText('Custom: custom 2')
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()

    const added = await addStatEntry(page, editor)
    const stat = added.getByRole('combobox', { name: 'Stat', exact: true })
    await expect(stat).toBeFocused()
    await expect(stat).toHaveText('Sum')
    await expect(statColumnLine(added)).toHaveText('Pick a field')
    await expect(statTrigger(editor, 2)).toHaveText('Sum (no field)')
    await page.keyboard.press('Escape')
    await expect(added).toBeHidden()
    await saveListEditor(editor)

    const saved = await saveAndRead(page, sheet, testId)
    const stats = saved.config.values.stats as Array<{ value: { stat: string } }>
    expect(
      stats.map((entry) => entry.value.stat),
      'Add stat appends an entry',
    ).toEqual(['count', 'custom', 'sum'])
  })

  test('V-PLUGIN-OPENSEARCH-01 outputs: Error and Reason only under Record and continue', async ({ page }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 outputs', SEARCH_VALUES)
    created.push(testId)

    await expectOutputs(sheet, CORE_OUTPUTS, 'fail the block')
    await expectOutputRows(sheet, CORE_OUTPUTS)

    await expandGroup(sheet, 'Failure Handling')
    await expect(enumTrigger(sheet, 'on_error')).toHaveText('Fail the block')
    await pickEnum(page, sheet, 'on_error', 'Record and continue')
    await expectOutputs(sheet, [...CORE_OUTPUTS, 'error', 'reason'], 'record and continue')
    await expectOutputRows(sheet, ['error', 'reason'])

    await pickEnum(page, sheet, 'on_error', 'Fail the block')
    await expectOutputs(sheet, CORE_OUTPUTS, 'fail the block again')
  })

  test('V-PLUGIN-OPENSEARCH-01 Query DSL: the Query row opens in Query DSL and keeps the DQL text', async ({
    page,
  }) => {
    const { testId, sheet } = await openValidOpenSearchSheet(page, 'V-PLUGIN-OPENSEARCH-01 query dsl', {
      url: CLUSTER_URL,
      index: INDEX,
    })
    created.push(testId)
    const text = 'log.level: ERROR'

    // OS-5: a blank Query opens as a Template, its language fixed by Query language.
    let editor = await openFieldEditor(page, sheet, 'query')
    const kind = editor.locator('[data-testid="kind-dropdown"]')
    await expect(kind).toHaveText('Template')
    await expect(editor.locator('[data-testid="format-dropdown"]')).toHaveCount(0)
    await pickKind(page, editor, 'Literal')
    await expect(editor.locator('[data-testid="format-dropdown"]')).toHaveText('DQL')
    await pickKind(page, editor, 'Template')
    await editor.locator('.cm-content').first().click()
    await page.keyboard.insertText(text)
    const save = editor.locator('[data-testid="value-editor-save-button"]')
    await save.click()
    await expect(save).toBeDisabled()
    await editor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(editor).toBeHidden()
    await expect(editPreview(sheet, 'query')).toHaveValue(text)

    await pickEnum(page, sheet, 'query_language', 'Query DSL')
    await expectLayout(sheet, [...SEARCH_ROWS, ...SEARCH_TAIL], 'Query DSL keeps the one Query row')
    await expect(editPreview(sheet, 'query')).toHaveValue(text)

    editor = await openFieldEditor(page, sheet, 'query')
    await expect(editor.locator('.cm-content').first()).toHaveText(text)
    await expect(editor.locator('[data-testid="kind-dropdown"]')).toHaveText('Template')
    await pickKind(page, editor, 'Literal')
    const format = editor.locator('[data-testid="format-dropdown"]')
    await expect(format).toHaveText('Query DSL')
    await expect(format).toBeDisabled()
    await closeValueEditor(page, editor)
    await expect(page.locator('[data-testid="value-editor-sheet"]')).toHaveCount(0)

    const saved = await saveAndRead(page, sheet, testId)
    expect(saved.config.values.query_language).toBe('query_dsl')
    expect(saved.config.values.query, 'the DQL text is kept').toBe(text)
    expect(saved.templateFields, 'Query stays a Template').toContain('query')
  })
})
