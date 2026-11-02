/**
 * V-PLUGIN-OPENSEARCH-02: OpenSearch editor states
 * Design Decisions: OS-5, OS-7, OS-12, OS-13, FIELD-2, FIELD-3, FIELD-10
 * REQ: REQ-3.3.2.5, REQ-3.3.2.6, REQ-3.3.3.2
 *
 * Runs in the no-data project list against the real OpenSearch service. beforeAll seeds F-LOGS as
 * wave-e2e-<token>-app-logs and D-DAILY as wave-e2e-<token>-daily-<date> (today and the two days before);
 * every test seeds its own Test (Cluster URL from the config constants, user wave, the lab CA, Verify on);
 * afterAll deletes the Tests, clears the workbench session and deletes the indexes. Theme-agnostic DOM
 * assertions.
 *
 * Pass Criteria:
 * 1. The Query row opens the Edit value sheet in DQL mode: STRING badge, Kind Template (Literal / Template
 *    offered), Format DQL locked and hidden in Template, F1 Help opening the keyboard list, the chip
 *    Get fields, then Close / Save / Run with Run primary.
 * 2. Coloring: field names before ":" in the property color, and / or / not in the keyword color, quoted
 *    phrases in the string color, {{ svc }} in the placeholder color.
 * 3. With nothing loaded, the list at a field position holds the single action row "Get fields from the
 *    cluster"; picking it pulls the list and inserts nothing; the open list then shows the fields under
 *    the header Fields.
 * 4. Chip states: Getting fields... with a spinner and Stop getting fields; Got N fields with a check
 *    (N = the index's field count); Fields · N with Refresh fields beside it; the settled chip opens the
 *    Fields popover (Search fields…) whose click inserts the name at the cursor.
 * 5. A block whose Cluster URL is https://127.0.0.1:9479 shows Could not get fields with the Unreachable
 *    message as its tooltip; a click tries again.
 * 6. After "service." the FIELDS list shows service.name and service.version, each with keyword muted on
 *    the right.
 * 7. "log.invalid: ERROR" gets the amber underline and the strip line "Unknown field log.invalid in
 *    wave-e2e-<token>-app-logs"; Save and Run stay enabled.
 * 8. Query DSL: JSON coloring holds in Template kind; after "operator": " the list offers and and or.
 * 9. Query DSL: typing {"mat offers match, match_all and match_phrase with their descriptions.
 * 10. A Custom (JSON) stat's Edit JSON (from the Stats editor) opens the aggregation mode: no Kind, Format JSON, no Run;
 *     {"avg": {"invalid_param": "latency_ms"}} underlines "invalid_param" with '"invalid_param" is not a parameter of avg'.
 * 11. Index pattern wave-e2e-<token>-*: the row's Get indexes lists wave-e2e-<token>-app-logs and the
 *     folded wave-e2e-<token>-daily-* with 3 indexes; the Time field row, not set, shows @timestamp in
 *     gray with no reset icon and offers only @timestamp; picked, it is the value (not gray) and the reset
 *     icon shows; a Sum stat's Field in the Stats editor offers only latency_ms; app-logs picked in Index
 *     pattern is the value, with no reset icon since the row has no default.
 * 12. A blank Index pattern: the editor chip Get fields is disabled with the tooltip "Fill in Index pattern
 *     to get fields", and the suggestion list has no Get fields row.
 * 13. DQL keys: Ctrl+F opens the find panel, Esc closes it, Ctrl+G opens the Go to line prompt.
 * 14. Size: after a plain Edit value sheet is moved and closed, the Query editor opens at 720 x 460;
 *     dragging its corner grip up-left as far as it goes leaves the width at 720, and with Query DSL, Kind
 *     Literal and the failed chip every footer label stays on one line and Run stays inside the sheet.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Locator, type Page, type Route } from '../../helpers/playwright-fixtures'
import { FRONTEND_URL } from '../../helpers/config'
import { expandGroup } from '../../functional/file-picker/picker'
import { clearSettledWorkbenchSession } from '../../helpers/k8s-run'
import {
  tablesChip as catalogChip,
  tablesChipStatus as catalogChipStatus,
  tablesPopover as catalogPopover,
  typeScript,
} from '../../functional/python-block/editor-helpers'
import {
  clickSuggestFooter,
  dismissSuggestions,
  elementColor,
  openFieldEditor,
  openListEditor,
  openStatEntry,
  openSuggestions,
  pickSuggestion,
  resolvedColor,
  statFieldBox,
  suggestInput,
} from '../../helpers/config-sheet'
import { resetButton } from '../../helpers/value-field'
import {
  F_LOGS,
  MAP_LOGS,
  createOpenSearchIndex,
  dailyDocs,
  dailyIndexNames,
  deleteOpenSearchIndexes,
  openSearchFieldCount,
  openSearchIndexName,
  seedOpenSearch,
} from '../../helpers/opensearch-stack'
import { newToken } from '../../functional/shell-blocks/shell-helpers'
import {
  deleteOpenSearchTests,
  openIncompleteOpenSearchSheet,
  openOpenSearchSheet,
  openSearchFixture,
  realClusterValues,
  seedTest,
  type OpenSearchBlockOptions,
} from './opensearch-sheet-seed'

type Values = Record<string, unknown>

// --- expected content ---------------------------------------------------------

/** Port 9479: nothing listens there in either mode. */
const UNREACHABLE_URL = 'https://127.0.0.1:9479'
const UNREACHABLE_MESSAGE = 'Could not connect to OpenSearch at 127.0.0.1:9479: '
const GET_FIELDS_ACTION = 'Get fields from the cluster'
const FILL_IN_INDEX_PATTERN = 'Fill in Index pattern to get fields'
const AMBER_UNDERLINE = 'rgb(245, 158, 11)'
const OPENSEARCH_HELP_ACTIONS = [
  'Autocomplete',
  'Run',
  'Save',
  'Close',
  'Find and replace',
  'Go to line',
  'Indent / outdent',
  'Undo / redo',
]

/** MAP-LOGS as Get fields lists it: every leaf and every object parent, sorted. */
const LOG_FIELDS = [
  '@timestamp',
  'host',
  'host.name',
  'latency_ms',
  'log',
  'log.level',
  'message',
  'service',
  'service.name',
  'service.version',
  'trace',
  'trace.id',
  'user',
  'user.id',
  'user.name',
  'user.roles',
]

/** The wireframe's query, with `not` added so all three keywords are read. */
const DQL_TEXT = [
  'log.level:ERROR or (log.level:INFO and not message:"Load test finished")',
  'and service.name:{{ svc }} and host.name:check',
].join('\n')

const DSL_TEXT =
  '{"bool": {"filter": [{"term": {"service.name": "{{ svc }}"}}, {"range": {"latency_ms": {"gte": 800}}}], ' +
  '"must": [{"match": {"message": "Payment failed"}}]}}'

/** Typed up to the operator's value; the spec types the opening quote. */
const OPERATOR_TEXT = '{"match": {"message": {"query": "Payment", "operator": '

const AGGREGATION_TEXT = '{"avg": {"invalid_param": "latency_ms"}}'

const KEYS_QUERY = 'log.level: ERROR\nor message: "Payment failed"'

const SVC_VARIABLE = { svc: { value: 'checkout', type: 'string', scope: 'test' } }

type TokenRole = 'property' | 'keyword' | 'string' | 'number'

/** OS-12: the query palette, One Dark on dark. */
const QUERY_PALETTE: Record<'dark' | 'light', Record<TokenRole, string>> = {
  dark: { property: '#e06c75', keyword: '#c678dd', string: '#98c379', number: '#e5c07b' },
  light: { property: '#008855', keyword: '#770088', string: '#aa1111', number: '#116644' },
}
const PLACEHOLDER_COLOR = '#22d3ee'

const DQL_TOKENS: ReadonlyArray<[string, number, TokenRole]> = [
  ['log.level', 2, 'property'],
  ['message', 1, 'property'],
  ['service.name', 1, 'property'],
  ['host.name', 1, 'property'],
  ['or', 1, 'keyword'],
  ['and', 3, 'keyword'],
  ['not', 1, 'keyword'],
  ['"Load test finished"', 1, 'string'],
]

const DSL_TOKENS: ReadonlyArray<[string, number, TokenRole]> = [
  ...['"bool"', '"filter"', '"term"', '"service.name"', '"range"', '"latency_ms"', '"gte"', '"must"', '"match"'].map(
    (key): [string, number, TokenRole] => [key, 1, 'property'],
  ),
  ['"message"', 1, 'property'],
  ['"Payment failed"', 1, 'string'],
  ['"', 2, 'string'],
  ['800', 1, 'number'],
]

// --- per-worker state -----------------------------------------------------------

let token = ''
const created: string[] = []

const appLogs = (): string => openSearchIndexName(token, 'app-logs')

/** The connection rows that reach the E2E cluster, on this run's app-logs index. */
const logsBlock = (extra: Values = {}): Values => ({ ...realClusterValues(appLogs()), ...extra })

// --- locators -------------------------------------------------------------------

const footer = (editor: Locator, id: string): Locator => editor.locator(`[data-testid="${id}"]`)
const chipButton = (editor: Locator): Locator =>
  catalogChip(editor).locator('button:not([aria-label="Refresh fields"]):not([aria-label="Stop getting fields"])')
const chipStop = (editor: Locator): Locator => catalogChip(editor).getByRole('button', { name: 'Stop getting fields' })
const chipRefresh = (editor: Locator): Locator => catalogChip(editor).getByRole('button', { name: 'Refresh fields' })
const completion = (page: Page): Locator => page.locator('.cm-tooltip-autocomplete ul[role="listbox"]').first()
/** The list once its source has answered; a disabled list waits on a new answer and passes arrow keys to the editor. */
const answeredCompletion = (page: Page): Locator =>
  page.locator('.cm-tooltip-autocomplete:not(.cm-tooltip-autocomplete-disabled) ul[role="listbox"]').first()
const strip = (editor: Locator): Locator => editor.locator('[data-testid="value-editor-validation"]')
const editorLine = (editor: Locator, line: number): Locator => editor.locator('.cm-content .cm-line').nth(line - 1)
const openTooltip = (page: Page): Locator => page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')

// --- seed and open ----------------------------------------------------------------

/** Persist a one-block Test (with optional Test variables); returns its id. */
async function seedBlock(
  page: Page,
  name: string,
  values: Values,
  options: OpenSearchBlockOptions = {},
  variables?: Record<string, unknown>,
): Promise<string> {
  const fixture = openSearchFixture(`V-PLUGIN-OPENSEARCH-02 ${name}`, values, options)
  if (variables) fixture.variables = variables
  const testId = await seedTest(page.request, fixture)
  created.push(testId)
  return testId
}

/** Seed a block, open its sheet and the Query row's Edit value sheet. */
async function openQueryEditor(
  page: Page,
  name: string,
  values: Values,
  options: OpenSearchBlockOptions = {},
  variables?: Record<string, unknown>,
): Promise<{ sheet: Locator; editor: Locator }> {
  const testId = await seedBlock(page, name, values, options, variables)
  const sheet = await openOpenSearchSheet(page, testId)
  const editor = await openFieldEditor(page, sheet, 'query')
  await expect(editor.locator('.cm-content')).toBeVisible()
  return { sheet, editor }
}

// --- editor helpers -----------------------------------------------------------------

async function pickKind(page: Page, editor: Locator, kind: 'Literal' | 'Template'): Promise<void> {
  const dropdown = footer(editor, 'kind-dropdown')
  await dropdown.click()
  await page.getByRole('option', { name: kind, exact: true }).click()
  await expect(dropdown).toHaveText(kind)
}

async function editorText(editor: Locator): Promise<string> {
  return editor
    .locator('.cm-content .cm-line')
    .evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n'))
}

async function cursorAtLineEnd(page: Page, editor: Locator, line: number): Promise<void> {
  await editorLine(editor, line).click()
  await page.keyboard.press('End')
}

/** Replace the whole text in one insert (no bracket pairing); focus, not a click, so no popover takes it. */
async function replaceText(page: Page, editor: Locator, text: string): Promise<void> {
  const content = editor.locator('.cm-content').first()
  await content.focus()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
  await expect.poll(() => editorText(editor)).toBe(text)
  await leaveExpressionEditor(editor)
  // Back in the editor, caret kept, for the caller's next keys.
  await content.focus()
}

/** Start the Get fields pull from the idle chip and wait until it has loaded. */
async function loadFields(editor: Locator): Promise<void> {
  await expect(catalogChip(editor)).toHaveAttribute('data-state', 'idle')
  await chipButton(editor).click()
  await expect(catalogChip(editor)).toHaveAttribute('data-state', /^(done|settled)$/, { timeout: 30_000 })
}

type Section = { header: string; transform: string; rows: Array<{ label: string; icon: string }> }

/** The rendered suggestion rows under each section header, with their icon classes. */
function suggestionSections(page: Page): Promise<Section[]> {
  return completion(page).evaluate((ul) => {
    const sections: Section[] = []
    for (const child of Array.from(ul.children)) {
      if (child.classList.contains('cm-completionSection')) {
        sections.push({
          header: (child.textContent ?? '').trim(),
          transform: globalThis.getComputedStyle(child).textTransform,
          rows: [],
        })
        continue
      }
      if (child.tagName !== 'LI') continue
      sections.at(-1)?.rows.push({
        label: child.querySelector('.cm-completionLabel')?.textContent ?? '',
        icon: child.querySelector('.cm-completionIcon')?.className ?? '',
      })
    }
    return sections
  })
}

async function sectionLabels(page: Page): Promise<Array<[string, string[]]>> {
  return (await suggestionSections(page)).map((section) => [section.header, section.rows.map((row) => row.label).sort()])
}

function rowLabels(page: Page): Promise<string[]> {
  return completion(page).locator('li[role="option"] .cm-completionLabel').allInnerTexts()
}

interface RowLayout {
  label: string
  detail: string
  detailOpacity: number
  labelRight: number
  detailLeft: number
  detailRight: number
  rowRight: number
}

/** Each suggestion row's label and detail with where they sit. */
function rowLayouts(page: Page): Promise<RowLayout[]> {
  return completion(page)
    .locator('li[role="option"]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const label = row.querySelector('.cm-completionLabel') as HTMLElement
        const detail = row.querySelector('.cm-completionDetail') as HTMLElement | null
        const labelBox = label.getBoundingClientRect()
        const detailBox = detail?.getBoundingClientRect()
        return {
          label: label.textContent ?? '',
          detail: detail?.textContent ?? '',
          detailOpacity: detail ? Number(globalThis.getComputedStyle(detail).opacity) : 1,
          labelRight: labelBox.right,
          detailLeft: detailBox?.left ?? 0,
          detailRight: detailBox?.right ?? 0,
          rowRight: row.getBoundingClientRect().right,
        }
      }),
    )
}

interface TokenRun {
  text: string
  color: string
  placeholder: boolean
}

/** Every text run of the editor with its color as sRGB hex; `placeholder` marks a {{ }} region. */
function tokenRuns(editor: Locator): Promise<TokenRun[]> {
  return editor
    .locator('.cm-content')
    .first()
    .evaluate((content) => {
      const context = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
      const hex = (color: string): string => {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data
        return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
      }
      const runs: TokenRun[] = []
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement as HTMLElement
        runs.push({
          text: node.textContent ?? '',
          color: hex(globalThis.getComputedStyle(parent).color),
          placeholder: parent.closest('.cm-expression') !== null,
        })
      }
      return runs
    })
}

async function queryPalette(page: Page): Promise<Record<TokenRole, string>> {
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  return QUERY_PALETTE[dark ? 'dark' : 'light']
}

/** Each listed token is its own run in its role's color; {{ svc }} is one region in the placeholder color. */
async function expectColors(
  editor: Locator,
  palette: Record<TokenRole, string>,
  tokens: ReadonlyArray<[string, number, TokenRole]>,
): Promise<void> {
  await expect(async () => {
    const runs = await tokenRuns(editor)
    for (const [text, count, role] of tokens) {
      const colors = runs.filter((run) => !run.placeholder && run.text === text).map((run) => run.color)
      expect(colors, `${text} in the ${role} color`).toEqual(new Array(count).fill(palette[role]))
    }
    const placeholder = runs.filter((run) => run.placeholder)
    expect(placeholder.map((run) => run.text).join(''), 'the {{ }} region').toBe('{{ svc }}')
    expect(new Set(placeholder.map((run) => run.color)), '{{ svc }} in the placeholder color').toEqual(
      new Set([PLACEHOLDER_COLOR]),
    )
  }).toPass({ timeout: 10_000 })
}

/** The underlined marks of the editor: text, line style and color. */
function underlines(editor: Locator): Promise<Array<{ text: string; line: string; style: string; color: string }>> {
  return editor.locator('.cm-content .cm-unknown-variable').evaluateAll((marks) =>
    marks
      .filter((mark) => !mark.parentElement?.closest('.cm-unknown-variable'))
      .map((mark) => {
        const style = globalThis.getComputedStyle(mark)
        return {
          text: mark.textContent ?? '',
          line: style.textDecorationLine,
          style: style.textDecorationStyle,
          color: style.textDecorationColor,
        }
      }),
  )
}

/** The computed color a CSS color value or a utility class resolves to on this page. */
function probeColor(page: Page, probe: { style?: string; className?: string }): Promise<string> {
  return page.evaluate(({ style, className }) => {
    const span = document.createElement('span')
    if (style) span.style.color = style
    if (className) span.className = className
    document.body.appendChild(span)
    const color = globalThis.getComputedStyle(span).color
    span.remove()
    return color
  }, probe)
}

interface ChipSnapshot {
  state: string | null
  text: string
  icons: string[]
  color: string
  refresh: boolean
}

/** The chip read in one go: the done state holds for three seconds only. */
function chipSnapshot(editor: Locator): Promise<ChipSnapshot> {
  return catalogChip(editor).evaluate((root) => {
    const primary = root.querySelector(
      'button:not([aria-label="Refresh fields"]):not([aria-label="Stop getting fields"])',
    )
    return {
      state: root.getAttribute('data-state'),
      text: (primary?.textContent ?? '').trim(),
      icons: primary ? Array.from(primary.querySelectorAll('svg')).map((svg) => svg.getAttribute('class') ?? '') : [],
      color: primary ? globalThis.getComputedStyle(primary).color : '',
      refresh: root.querySelector('button[aria-label="Refresh fields"]') !== null,
    }
  })
}

async function waitForChip(editor: Locator, state: string, timeout: number): Promise<ChipSnapshot> {
  let seen: ChipSnapshot | null = null
  await expect
    .poll(
      async () => {
        seen = await chipSnapshot(editor)
        return seen.state
      },
      { timeout, intervals: [100] },
    )
    .toBe(state)
  return seen as unknown as ChipSnapshot
}

/** Holds the page's fields pull on `pin.status`; GET and DELETE are counted, DELETE answered canceled. */
async function pinFieldsPull(
  page: Page,
  pin: { status: string; gets: number; deletes: number },
): Promise<() => Promise<void>> {
  const frontendOrigin = new URL(FRONTEND_URL).origin
  const matcher = (url: URL): boolean =>
    /^(\/api)?\/opensearch-tools\/fields(\/[^/]+)?$/.test(url.pathname) &&
    (url.origin !== frontendOrigin || url.pathname.startsWith('/api/'))
  const handler = async (route: Route): Promise<void> => {
    const method = route.request().method()
    const answer = (data: Record<string, unknown>) =>
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': route.request().headers().origin ?? frontendOrigin,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ success: true, data }),
      })
    if (method === 'POST') return answer({ job_id: 'v-plugin-opensearch-02-pinned', cached: false })
    if (method === 'GET') {
      pin.gets += 1
      return answer({ status: pin.status })
    }
    if (method === 'DELETE') {
      pin.deletes += 1
      return answer({ status: 'canceled' })
    }
    return route.fallback()
  }
  await page.route(matcher, handler)
  return () => page.unroute(matcher, handler)
}

const isOpenSearchToolPost = (request: { method(): string; url(): string }, tool: string): boolean =>
  request.method() === 'POST' && new URL(request.url()).pathname.endsWith(`/opensearch-tools/${tool}`)

const isFieldsPost = (request: { method(): string; url(): string }): boolean => isOpenSearchToolPost(request, 'fields')

/** How many lines the control's text takes: the most any one of its text runs wraps to. */
function textLines(control: Locator): Promise<number> {
  return control.evaluate((el) => {
    let most = 0
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const tops: number[] = []
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0 && !tops.some((top) => Math.abs(top - rect.top) < 4)) tops.push(rect.top)
      }
      most = Math.max(most, tops.length)
    }
    return most
  })
}

/** Whether the UI font the app names renders here, and how wide the failed chip's words are in the body font. */
function uiFontNote(page: Page): Promise<string> {
  return page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
    const width = (family: string): number => {
      context.font = `600 12px ${family}`
      return context.measureText('Could not get fields').width
    }
    const rendered = ['monospace', 'serif', 'sans-serif'].some(
      (fallback) => width(`"Plus Jakarta Sans", ${fallback}`) !== width(fallback),
    )
    const words = width(globalThis.getComputedStyle(document.body).fontFamily).toFixed(1)
    return `Plus Jakarta Sans ${rendered ? 'renders' : 'is missing'}; "Could not get fields" is ${words} px`
  })
}

/** Controls sit left to right on one row, each after the one before. */
async function expectOneRow(controls: Locator[]): Promise<void> {
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()))
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index]!.x, `footer control ${index} sits right of control ${index - 1}`).toBeGreaterThanOrEqual(
      boxes[index - 1]!.x + boxes[index - 1]!.width - 0.5,
    )
    const drift = Math.abs(boxes[index]!.y + boxes[index]!.height / 2 - (boxes[0]!.y + boxes[0]!.height / 2))
    expect(drift, `footer control ${index} shares the footer row`).toBeLessThanOrEqual(2)
  }
}

async function sheetSize(editor: Locator): Promise<{ width: number; height: number }> {
  const box = (await editor.boundingBox())!
  return { width: Math.round(box.width), height: Math.round(box.height) }
}

/** Every suggestion of an open field or index list: its name and the words in its pill. */
function listItems(list: Locator): Promise<Array<{ name: string; kind: string }>> {
  return list.locator('[cmdk-item]').evaluateAll((items) =>
    items.map((item) => ({
      name: item.getAttribute('data-value') ?? '',
      kind: (item.lastElementChild?.textContent ?? '').trim(),
    })),
  )
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

// --- tests ------------------------------------------------------------------------

test.describe('V-PLUGIN-OPENSEARCH-02: the OpenSearch editor', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000)
    token = newToken()
    const logs = appLogs()
    await createOpenSearchIndex(logs, MAP_LOGS)
    await seedOpenSearch(logs, F_LOGS)
    const now = new Date()
    const days = dailyIndexNames(token, now)
    const docs = dailyDocs(now)
    for (const [index, name] of days.entries()) {
      await createOpenSearchIndex(name, MAP_LOGS)
      await seedOpenSearch(name, [docs[index]])
    }
  })

  test.afterAll(async ({ request }) => {
    test.setTimeout(120_000)
    try {
      await deleteOpenSearchTests(request, created)
      await clearSettledWorkbenchSession(request)
    } finally {
      if (token) await deleteOpenSearchIndexes(token)
    }
  })

  test('V-PLUGIN-OPENSEARCH-02 DQL mode: Kind Template, Format DQL hidden, F1 Help, Get fields, Close / Save / Run (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { editor } = await openQueryEditor(
      page,
      'dql mode',
      logsBlock({ query: DQL_TEXT }),
      { templateFields: ['query'] },
      SVC_VARIABLE,
    )

    await test.step('STRING badge; Kind Template with Literal and Template offered', async () => {
      await expect(footer(editor, 'value-editor-type-badge')).toHaveText(/^string$/i)
      const kind = footer(editor, 'kind-dropdown')
      await expect(kind).toHaveText('Template')
      await kind.click()
      await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Literal', 'Template'])
      await page.getByRole('option', { name: 'Template', exact: true }).click()
      await expect(kind).toHaveText('Template')
    })

    await test.step('Format DQL: hidden in Template, locked in Literal', async () => {
      await expect(footer(editor, 'format-dropdown')).toHaveCount(0)
      await pickKind(page, editor, 'Literal')
      await expect(footer(editor, 'format-dropdown')).toHaveText('DQL')
      await expect(footer(editor, 'format-dropdown')).toBeDisabled()
      await pickKind(page, editor, 'Template')
      await expect(footer(editor, 'format-dropdown')).toHaveCount(0)
    })

    await test.step('F1 Help opens the keyboard list', async () => {
      const help = footer(editor, 'value-editor-help-chip')
      await expect(help.locator('kbd')).toHaveText('F1')
      await expect(help).toContainText('Help')
      await help.click()
      const popover = page.locator('[data-testid="opensearch-help-popover"]')
      await expect(popover).toBeVisible()
      await expect(popover.locator('h3')).toHaveText('Keyboard')
      await expect(popover.locator('[data-testid="opensearch-help-key-label"]')).toHaveText(OPENSEARCH_HELP_ACTIONS)
      await popover.getByRole('button', { name: 'Close help' }).click()
      await expect(popover).toBeHidden()
    })

    await test.step('the chip Get fields, then Close / Save / Run left to right with Run primary', async () => {
      await expect(catalogChip(editor)).toHaveAttribute('data-state', 'idle')
      await expect(chipButton(editor)).toHaveText('Get fields')
      await expect(chipButton(editor).locator('svg.lucide-database')).toHaveCount(1)
      await expectOneRow([
        footer(editor, 'kind-dropdown'),
        footer(editor, 'value-editor-help-chip'),
        chipButton(editor),
        footer(editor, 'value-editor-cancel-button'),
        footer(editor, 'value-editor-save-button'),
        footer(editor, 'value-editor-run-button'),
      ])
      await expect(footer(editor, 'value-editor-cancel-button')).toHaveText('Close')
      await expect(footer(editor, 'value-editor-save-button')).toHaveText('Save')
      await expect(footer(editor, 'value-editor-run-button')).toHaveText('Run')
      await expect(footer(editor, 'value-editor-run-button')).toHaveClass(/\bbtn-primary\b/)
      await expect(footer(editor, 'value-editor-save-button')).not.toHaveClass(/\bbtn-primary\b/)
      await expect(footer(editor, 'value-editor-cancel-button')).not.toHaveClass(/\bbtn-primary\b/)
      await expect(footer(editor, 'value-editor-run-button')).toBeEnabled()
    })
  })

  test('V-PLUGIN-OPENSEARCH-02 coloring: fields, and / or / not, phrases and {{ svc }} each in their color (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { editor } = await openQueryEditor(
      page,
      'coloring',
      logsBlock({ query: DQL_TEXT }),
      { templateFields: ['query'] },
      SVC_VARIABLE,
    )
    await expect(footer(editor, 'kind-dropdown')).toHaveText('Template')
    expect(await editorText(editor)).toBe(DQL_TEXT)
    await expectColors(editor, await queryPalette(page), DQL_TOKENS)
  })

  test('V-PLUGIN-OPENSEARCH-02 keys: Ctrl+F opens the find panel and Esc closes it, not the editor (DQL mode)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { editor } = await openQueryEditor(page, 'find keys', logsBlock({ query: KEYS_QUERY }))
    const lines = editor.locator('.cm-line')
    await expect(lines).toHaveCount(2)
    await lines.nth(1).click()

    await page.keyboard.press('ControlOrMeta+f')
    const find = editor.locator('.cm-search')
    await expect(find).toBeVisible()
    await expect(find.locator('input[name="search"]')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(find).toHaveCount(0)
    await expect(editor, 'Esc closed the find panel, not the editor').toBeVisible()
  })

  test("V-PLUGIN-OPENSEARCH-02 keys: Ctrl+G opens the Go to line prompt on the cursor's line (DQL mode)", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { editor } = await openQueryEditor(page, 'go to line key', logsBlock({ query: KEYS_QUERY }))
    const lines = editor.locator('.cm-line')
    await expect(lines).toHaveCount(2)
    await lines.nth(1).click()

    await page.keyboard.press('ControlOrMeta+g')
    const prompt = editor.locator('.cm-goto-line')
    await expect(prompt, 'Ctrl+G opens Go to line').toBeVisible()
    await expect(prompt).toContainText('Go to line')
    await expect(prompt.locator('input[name="line"]')).toBeFocused()
    await expect(prompt.locator('input[name="line"]')).toHaveValue('2')
    await expect(editor.locator('.cm-search'), 'Ctrl+G is not find').toHaveCount(0)
  })

  test('V-PLUGIN-OPENSEARCH-02 suggest: the Get fields row pulls the list, inserts nothing, and the list turns into the fields (OS-12, OS-13)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const sheet = await openOpenSearchSheet(page, await seedBlock(page, 'get fields row', logsBlock()))
    // Each check answer rebuilds the suggestion source, and a pick made while the new one is asked is dropped.
    const checked = page.waitForResponse((response) => isOpenSearchToolPost(response.request(), 'check'))
    const editor = await openFieldEditor(page, sheet, 'query')
    await expect(editor.locator('.cm-content')).toBeVisible()
    await checked
    await nextFrames(page)
    const count = await openSearchFieldCount(appLogs())
    expect(LOG_FIELDS, 'the expected list is the index field count').toHaveLength(count)

    await test.step('with nothing loaded, a field position lists only Get fields from the cluster', async () => {
      await editor.locator('.cm-content').first().click()
      await page.keyboard.press('Control+Space')
      await expect(completion(page)).toBeVisible()
      expect(await suggestionSections(page)).toEqual([
        {
          header: 'Fields',
          transform: 'uppercase',
          rows: [{ label: GET_FIELDS_ACTION, icon: expect.stringContaining('cm-completionIcon-opensearch-get-fields') }],
        },
      ])
    })

    await test.step('picking it pulls the list and inserts nothing; the open list then shows the fields', async () => {
      const before = await editorText(editor)
      // A click: the list ignores Enter for its first moments, so a fast Enter types a newline.
      await completion(page).locator('li[role="option"]').filter({ hasText: GET_FIELDS_ACTION }).click()
      await expect(catalogChip(editor)).toHaveAttribute('data-state', /^(done|settled)$/, { timeout: 30_000 })
      await expect(chipButton(editor)).toHaveText(new RegExp(`^(Got ${count} fields|Fields · ${count})$`))
      expect(await editorText(editor), 'the action row inserts nothing').toBe(before)
      await expect.poll(() => sectionLabels(page), { timeout: 15_000 }).toEqual([['Fields', LOG_FIELDS]])
      await leaveExpressionEditor(editor)
    })
  })

  test('V-PLUGIN-OPENSEARCH-02 chip states: Getting fields..., Got N fields, Fields · N, the Fields popover pick (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const query = 'log.level: ERROR and '
    const { editor } = await openQueryEditor(page, 'chip states', logsBlock({ query }))
    const count = await openSearchFieldCount(appLogs())

    await test.step('idle: Get fields with the database icon, no spinner and no Stop', async () => {
      await expect(catalogChip(editor)).toHaveAttribute('data-state', 'idle')
      await expect(chipButton(editor)).toHaveText('Get fields')
      await expect(chipButton(editor).locator('svg.lucide-database')).toHaveCount(1)
      await expect(catalogChip(editor).locator('[data-testid="get-tables-spinner"]')).toHaveCount(0)
      await expect(chipStop(editor)).toHaveCount(0)
    })

    const pin = { status: 'reading', gets: 0, deletes: 0 }
    const unpin = await pinFieldsPull(page, pin)
    try {
      await test.step('Getting fields... with a spinner and the square Stop getting fields', async () => {
        await chipButton(editor).click()
        await expect(catalogChip(editor)).toHaveAttribute('data-state', 'reading')
        await expect(catalogChipStatus(editor)).toHaveText('Getting fields...')
        await expect(catalogChipStatus(editor)).toBeVisible()
        await expect(catalogChip(editor).locator('[data-testid="get-tables-spinner"]')).toBeVisible()
        await expect(chipStop(editor)).toBeVisible()
        await expect(chipStop(editor).locator('svg.lucide-square')).toHaveCount(1)
        await expect(chipButton(editor)).toHaveCount(0)
        await expect.poll(() => pin.gets, { message: 'the pull is being polled' }).toBeGreaterThan(0)
      })

      await test.step('Stop cancels the pull on the server and returns the chip to Get fields', async () => {
        await chipStop(editor).click()
        await expect(catalogChip(editor)).toHaveAttribute('data-state', 'idle')
        await expect(chipButton(editor)).toHaveText('Get fields')
        await expect.poll(() => pin.deletes, { message: 'Stop sent the cancel' }).toBe(1)
      })
    } finally {
      await unpin()
    }

    const successText = await probeColor(page, { style: 'var(--color-success-text)' })

    await test.step('Got N fields with a check in the success colors, settling to Fields · N', async () => {
      await chipButton(editor).click()
      await page.mouse.move(4, 4)
      const done = await waitForChip(editor, 'done', 30_000)
      expect(done).toEqual({
        state: 'done',
        text: `Got ${count} fields`,
        icons: [expect.stringContaining('lucide-check')],
        color: successText,
        refresh: false,
      })
      const settled = await waitForChip(editor, 'settled', 6_000)
      expect(settled).toEqual({
        state: 'settled',
        text: `Fields · ${count}`,
        icons: [expect.stringContaining('lucide-database')],
        color: expect.any(String),
        refresh: true,
      })
    })

    await test.step('Refresh fields sits beside the settled chip', async () => {
      await expect(chipRefresh(editor)).toBeVisible()
      await expect(chipRefresh(editor).locator('svg.lucide-refresh-cw')).toHaveCount(1)
      const [label, refresh] = await Promise.all([chipButton(editor).boundingBox(), chipRefresh(editor).boundingBox()])
      expect(refresh!.x, 'refresh sits right of the chip').toBeGreaterThanOrEqual(label!.x + label!.width)
      expect(refresh!.x - (label!.x + label!.width), 'refresh sits beside the chip').toBeLessThanOrEqual(8)
      expect(Math.abs(refresh!.y + refresh!.height / 2 - (label!.y + label!.height / 2))).toBeLessThanOrEqual(1)
    })

    await test.step('the settled chip opens the Fields popover; a click inserts the name at the cursor', async () => {
      await cursorAtLineEnd(page, editor, 1)
      await leaveExpressionEditor(editor)
      await chipButton(editor).click()
      const popover = catalogPopover(page)
      await expect(popover).toBeVisible()
      await expect(popover).toHaveAttribute('aria-label', 'Fields')
      const search = popover.getByRole('combobox', { name: 'Search fields' })
      await expect(search).toBeFocused()
      await expect(search).toHaveAttribute('placeholder', 'Search fields…')
      await expect(popover.locator('[data-testid^="tables-popover-item-"]')).toHaveCount(count)
      await popover.locator('[data-testid="tables-popover-item-service.name"]').click()
      await expect(popover).toBeHidden()
      await expect.poll(() => editorText(editor)).toBe(`${query}service.name`)
      await expect(editor.locator('.cm-content')).toBeFocused()
    })
  })

  test('V-PLUGIN-OPENSEARCH-02 chip failed: Could not get fields with the Unreachable reason; a click tries again (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const { editor } = await openQueryEditor(page, 'chip failed', logsBlock({ url: UNREACHABLE_URL, query: 'log.level: ERROR' }))
    const errorText = await probeColor(page, { className: 'text-error' })

    await test.step('Could not get fields in the error color with the alert icon', async () => {
      await chipButton(editor).click()
      await expect(catalogChip(editor)).toHaveAttribute('data-state', 'failed', { timeout: 60_000 })
      await expect(chipButton(editor)).toHaveText('Could not get fields')
      await expect(chipButton(editor).locator('svg.lucide-circle-alert')).toHaveCount(1)
      await expect(chipButton(editor)).toHaveCSS('color', errorText)
      await expect(chipStop(editor)).toHaveCount(0)
      await expect(chipRefresh(editor)).toHaveCount(0)
    })

    await test.step('its tooltip is the Unreachable message', async () => {
      await chipButton(editor).hover()
      await expect(openTooltip(page)).toBeVisible({ timeout: 10_000 })
      await expect(openTooltip(page).locator('[role="tooltip"]')).toContainText(UNREACHABLE_MESSAGE)
      await page.mouse.move(4, 4)
    })

    await test.step('a click tries again and ends failed again', async () => {
      const retry = page.waitForRequest(isFieldsPost)
      await chipButton(editor).click()
      await retry
      await expect(catalogChip(editor)).toHaveAttribute('data-state', 'reading')
      await expect(catalogChip(editor)).toHaveAttribute('data-state', 'failed', { timeout: 60_000 })
      await expect(chipButton(editor)).toHaveText('Could not get fields')
    })
  })

  test('V-PLUGIN-OPENSEARCH-02 FIELDS list: after service. it shows service.name and service.version with keyword (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { editor } = await openQueryEditor(page, 'fields list', logsBlock({ query: 'log.level: ERROR' }))
    await loadFields(editor)
    await cursorAtLineEnd(page, editor, 1)
    await page.keyboard.type(' and service.')
    await expect(editorLine(editor, 1)).toHaveText('log.level: ERROR and service.')

    await expect
      .poll(() => sectionLabels(page), { timeout: 15_000 })
      .toEqual([['Fields', ['service.name', 'service.version']]])
    const [section] = await suggestionSections(page)
    expect(section.transform, 'the header reads FIELDS').toBe('uppercase')

    const rows = await rowLayouts(page)
    expect(rows.map((row) => [row.label, row.detail])).toEqual([
      ['service.name', 'keyword'],
      ['service.version', 'keyword'],
    ])
    for (const row of rows) {
      expect(row.detailOpacity, `${row.label}: keyword is muted`).toBeLessThan(1)
      expect(row.detailLeft, `${row.label}: keyword sits right of the name`).toBeGreaterThanOrEqual(row.labelRight)
      expect(row.rowRight - row.detailRight, `${row.label}: keyword sits at the right end`).toBeLessThanOrEqual(16)
    }
    await leaveExpressionEditor(editor)
  })

  test('V-PLUGIN-OPENSEARCH-02 unknown field: log.invalid underlined, the strip names the index, Save and Run stay enabled (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { editor } = await openQueryEditor(page, 'unknown field', logsBlock({ query: 'log.level: ERROR' }))
    await loadFields(editor)
    await typeScript(page, editor, 'log.invalid: ERROR')

    await expect(strip(editor)).toHaveText(`Line 1: Unknown field log.invalid in ${appLogs()}`, { timeout: 15_000 })
    await expect(strip(editor), 'check warnings are advisory, not an alert').not.toHaveAttribute('role', 'alert')
    await expect(strip(editor)).toHaveClass(/\bbg-amber-500\/10\b/)
    await expect
      .poll(() => underlines(editor))
      .toEqual([{ text: 'log.invalid', line: 'underline', style: 'wavy', color: AMBER_UNDERLINE }])
    await expect(footer(editor, 'value-editor-save-button')).toBeEnabled()
    await expect(footer(editor, 'value-editor-run-button')).toBeEnabled()
  })

  test('V-PLUGIN-OPENSEARCH-02 Query DSL: JSON coloring in Template kind; "operator" offers and and or (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { editor } = await openQueryEditor(
      page,
      'query dsl',
      logsBlock({ query_language: 'query_dsl', query: DSL_TEXT }),
      { templateFields: ['query'] },
      SVC_VARIABLE,
    )

    await test.step('JSON coloring holds in Template kind', async () => {
      await expect(footer(editor, 'kind-dropdown')).toHaveText('Template')
      await expect(footer(editor, 'format-dropdown')).toHaveCount(0)
      expect(await editorText(editor)).toBe(DSL_TEXT)
      await expectColors(editor, await queryPalette(page), DSL_TOKENS)
    })

    await test.step('after "operator": " the list offers and and or', async () => {
      await replaceText(page, editor, OPERATOR_TEXT)
      await page.keyboard.type('"')
      await expect.poll(() => editorText(editor)).toBe(`${OPERATOR_TEXT}""`)
      await page.keyboard.press('Control+Space')
      await expect(completion(page)).toBeVisible()
      await expect.poll(() => rowLabels(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(['and', 'or']))
      await leaveExpressionEditor(editor)
    })
  })

  test('V-PLUGIN-OPENSEARCH-02 Query DSL: {"mat offers match, match_all and match_phrase with their descriptions (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { editor } = await openQueryEditor(page, 'query dsl keys', logsBlock({ query_language: 'query_dsl' }))
    await replaceText(page, editor, '')
    // Each check answer rebuilds the suggestion source and disables an open list, so open it after the typed text's check.
    const checked = page.waitForResponse(
      (response) =>
        isOpenSearchToolPost(response.request(), 'check') &&
        (response.request().postDataJSON() as { text?: string } | null)?.text === '{"mat"}',
    )
    await page.keyboard.type('{"mat')
    await expect.poll(() => editorText(editor)).toBe('{"mat"}')
    await checked
    await nextFrames(page)
    await page.keyboard.press('Control+Space')
    await expect(answeredCompletion(page)).toBeVisible({ timeout: 15_000 })
    const offered = ['match', 'match_all', 'match_phrase']
    await expect.poll(() => rowLabels(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(offered))

    for (const label of offered) {
      await expect(answeredCompletion(page)).toBeVisible()
      const labels = await rowLabels(page)
      const selected = answeredCompletion(page).locator('li[aria-selected="true"] .cm-completionLabel')
      const from = labels.indexOf(await selected.innerText())
      for (let step = from; step < labels.indexOf(label); step += 1) await page.keyboard.press('ArrowDown')
      await expect(selected).toHaveText(label)
      await expect(page.locator('.cm-tooltip.cm-completionInfo'), `the description of ${label}`).toHaveText(/\S/, {
        timeout: 5_000,
      })
    }
  })

  test('V-PLUGIN-OPENSEARCH-02 Custom (JSON): Edit JSON opens the aggregation mode; "invalid_param" is not a parameter of avg (OS-7, OS-12)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const testId = await seedBlock(
      page,
      'custom json',
      logsBlock({
        mode: 'aggregate',
        stats: [{ value: { stat: 'custom', json: '{"max": {"field": "latency_ms"}}', name: 'slowest' } }],
      }),
    )
    const sheet = await openOpenSearchSheet(page, testId)
    const stats = await openListEditor(page, sheet, 'stats')
    const popover = await openStatEntry(page, stats, 0)
    await popover.getByRole('button', { name: 'Edit JSON' }).click()
    // The aggregation editor opens beside the Stats editor, as its own Edit value sheet.
    const editor = page
      .locator('[data-testid="value-editor-sheet"]')
      .filter({ hasNot: page.locator('[data-testid="array-edit-body"]') })
    await expect(editor).toBeVisible()
    await expect(editor.locator('.cm-content')).toBeVisible()

    await test.step('the aggregation mode: no Kind, Format JSON, no Run', async () => {
      await expect(footer(editor, 'value-editor-save-button')).toBeVisible()
      await expect(footer(editor, 'kind-dropdown')).toHaveCount(0)
      await expect(footer(editor, 'format-dropdown')).toHaveText('JSON')
      await expect(footer(editor, 'format-dropdown')).toBeDisabled()
      await expect(footer(editor, 'value-editor-run-button')).toHaveCount(0)
    })

    await test.step('an unknown avg parameter is underlined with its message', async () => {
      await replaceText(page, editor, AGGREGATION_TEXT)
      await expect(strip(editor)).toHaveText('Line 1: "invalid_param" is not a parameter of avg', { timeout: 15_000 })
      await expect
        .poll(() => underlines(editor))
        .toEqual([{ text: '"invalid_param"', line: 'underline', style: 'wavy', color: AMBER_UNDERLINE }])
    })
  })

  test('V-PLUGIN-OPENSEARCH-02 indexes and field kinds: Get indexes folds the daily indexes, Time field and Sum offer their kinds (OS-13)', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const pattern = openSearchIndexName(token, '*')
    const testId = await seedBlock(
      page,
      'indexes',
      {
        ...realClusterValues(pattern),
        mode: 'aggregate',
        stats: [{ value: { stat: 'count' } }, { value: { stat: 'sum', field: 'latency_ms' } }],
      },
    )
    const sheet = await openOpenSearchSheet(page, testId)

    await test.step('the Index pattern row lists app-logs and the folded daily-* through Get indexes', async () => {
      const box = suggestInput(sheet, 'index')
      await expect(box).toHaveValue(pattern)
      const list = await openSuggestions(page, box)
      await expect(list.getByRole('button', { name: 'Get indexes', exact: true })).toBeVisible()
      await clickSuggestFooter(page, box, 'Get indexes')
      await expect
        .poll(async () => listItems(await openSuggestions(page, box)), { timeout: 30_000 })
        .toEqual([
          { name: appLogs(), kind: 'index' },
          { name: openSearchIndexName(token, 'daily-*'), kind: '3 indexes' },
        ])
      await dismissSuggestions(box)
    })

    const muted = await resolvedColor(page, 'var(--color-text-muted)')

    await test.step('the Time field row offers only @timestamp; picked, the default becomes the value', async () => {
      await expandGroup(sheet, 'Advanced')
      const box = suggestInput(sheet, 'time_field')
      // Not set: the default shows in gray as real text, with no reset icon.
      await expect(box).toHaveValue('@timestamp')
      expect(await elementColor(box, 'color'), 'the not-set Time field is gray').toBe(muted)
      await expect(resetButton(sheet, 'time_field')).toHaveCount(0)
      const list = await openSuggestions(page, box)
      await expect.poll(async () => (await listItems(list)).map((item) => item.name)).toEqual(['@timestamp'])
      await pickSuggestion(page, box, '@timestamp')
      await dismissSuggestions(box)
      expect(await elementColor(box, 'color'), 'a picked name is the value, not gray').not.toBe(muted)
      await expect(resetButton(sheet, 'time_field'), 'the field has a default, so reset shows').toHaveCount(1)
    })

    await test.step("a Sum stat's Field offers only the numeric latency_ms", async () => {
      const stats = await openListEditor(page, sheet, 'stats')
      const popover = await openStatEntry(page, stats, 1)
      const box = statFieldBox(popover)
      await expect(box).toHaveValue('latency_ms')
      const list = await openSuggestions(page, box)
      await expect.poll(async () => (await listItems(list)).map((item) => item.name)).toEqual(['latency_ms'])
      await dismissSuggestions(box)
      await page.keyboard.press('Escape')
      await expect(popover).toBeHidden()
      await stats.locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(stats).toBeHidden()
    })

    await test.step('a picked index is the value; Index pattern has no default, so no reset', async () => {
      const box = suggestInput(sheet, 'index')
      await pickSuggestion(page, box, appLogs())
      await dismissSuggestions(box)
      await expect(box).toHaveValue(appLogs())
      expect(await elementColor(box, 'color'), 'the picked index is not gray').not.toBe(muted)
      await expect(resetButton(sheet, 'index')).toHaveCount(0)
    })
  })

  test('V-PLUGIN-OPENSEARCH-02 blank Index pattern: the editor chip Get fields is disabled with the Fill in note (OS-13)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { index: _blank, ...connection } = realClusterValues('')
    const opened = await openIncompleteOpenSearchSheet(
      page,
      'V-PLUGIN-OPENSEARCH-02 blank index',
      { ...connection, query: 'log.level: ERROR' },
      ['index'],
    )
    created.push(opened.testId)
    const editor = await openFieldEditor(page, opened.sheet, 'query')
    await expect(editor.locator('.cm-content')).toBeVisible()
    const posts: string[] = []
    page.on('request', (request) => {
      if (isFieldsPost(request)) posts.push(request.url())
    })

    await test.step('the chip reads Get fields, disabled and dimmed, with the Fill in note as its tooltip', async () => {
      await expect(catalogChip(editor)).toHaveAttribute('data-state', 'idle')
      await expect(chipButton(editor)).toHaveText('Get fields')
      await expect(chipButton(editor)).toHaveAttribute('aria-disabled', 'true')
      await expect(chipButton(editor)).toBeDisabled()
      await expect(chipButton(editor)).toHaveClass(/\bopacity-50\b/)
      await expect(chipButton(editor)).toHaveClass(/\bcursor-not-allowed\b/)
      await chipButton(editor).hover()
      await expect(openTooltip(page)).toBeVisible({ timeout: 10_000 })
      await expect(openTooltip(page).locator('[role="tooltip"]')).toHaveText(FILL_IN_INDEX_PATTERN)
      // Forced: Playwright refuses an aria-disabled target, a user's click still lands on it.
      await chipButton(editor).click({ force: true })
      await expect(catalogChip(editor)).toHaveAttribute('data-state', 'idle')
      await expect(chipButton(editor)).toHaveText('Get fields')
      expect(posts, 'a click on the disabled chip starts no pull').toEqual([])
      await page.mouse.move(4, 4)
    })

    await test.step('the suggestion list at a field position has no Get fields row', async () => {
      await cursorAtLineEnd(page, editor, 1)
      await page.keyboard.type(' and ')
      const answered = page.waitForResponse((response) => isOpenSearchToolPost(response.request(), 'suggest'))
      await page.keyboard.press('Control+Space')
      await answered
      await nextFrames(page)
      await expect(page.locator('.cm-tooltip-autocomplete li').filter({ hasText: GET_FIELDS_ACTION })).toHaveCount(0)
      expect(posts, 'nothing started a pull').toEqual([])
    })
  })

  test('V-PLUGIN-OPENSEARCH-02 size: the Query editor opens at 720 x 460 and keeps its footer on one line at the 720 floor (OS-12)', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const testId = await seedBlock(
      page,
      'size',
      logsBlock({ url: UNREACHABLE_URL, query_language: 'query_dsl', query: '{"match_all": {}}' }),
    )
    const sheet = await openOpenSearchSheet(page, testId)

    await test.step('a plain Edit value sheet is moved, then closed', async () => {
      const plain = await openFieldEditor(page, sheet, 'url')
      await expect(footer(plain, 'value-editor-run-button'), 'the Cluster URL sheet is a plain one').toHaveCount(0)
      const before = (await plain.boundingBox())!
      const handle = (await plain.locator('[data-testid="value-editor-sheet-drag-handle"]').boundingBox())!
      await page.mouse.move(handle.x + 44, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + 44 - 160, handle.y + handle.height / 2 - 60, { steps: 12 })
      await page.mouse.up()
      await expect.poll(async () => (await plain.boundingBox())!.x).toBeLessThan(before.x - 100)
      await footer(plain, 'value-editor-cancel-button').click()
      await expect(plain).toBeHidden()
    })

    const editor = await openFieldEditor(page, sheet, 'query')
    await expect(editor.locator('.cm-content')).toBeVisible()

    await test.step('the Query editor opens at 720 x 460', async () => {
      await expect(footer(editor, 'value-editor-run-button')).toBeVisible()
      await expect.poll(() => sheetSize(editor)).toEqual({ width: 720, height: 460 })
    })

    await test.step('Kind Literal shows Format Query DSL', async () => {
      if ((await footer(editor, 'kind-dropdown').innerText()).trim() !== 'Literal') await pickKind(page, editor, 'Literal')
      await expect(footer(editor, 'format-dropdown')).toHaveText('Query DSL')
    })

    await test.step('the corner grip dragged up-left as far as it goes leaves the width at 720', async () => {
      const corner = (await editor.locator('[data-testid="dialog-resize-corner"]').boundingBox())!
      await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2)
      await page.mouse.down()
      await page.mouse.move(2, 2, { steps: 16 })
      await page.mouse.up()
      await expect.poll(async () => (await sheetSize(editor)).height, { message: 'the drag took hold' }).toBeLessThan(460)
      expect((await sheetSize(editor)).width).toBe(720)
    })

    await test.step('with the failed chip every footer label is on one line and Run is inside the sheet', async () => {
      await chipButton(editor).click()
      await expect(catalogChip(editor)).toHaveAttribute('data-state', 'failed', { timeout: 60_000 })
      await expect(chipButton(editor)).toHaveText('Could not get fields')
      await page.mouse.move(4, 4)
      expect((await sheetSize(editor)).width, 'the failed chip does not widen the sheet').toBe(720)

      const [sheetBox, run] = await Promise.all([editor.boundingBox(), footer(editor, 'value-editor-run-button').boundingBox()])
      expect(run!.x, 'Run starts inside the sheet').toBeGreaterThanOrEqual(sheetBox!.x)
      expect(run!.x + run!.width, 'Run ends inside the sheet').toBeLessThanOrEqual(sheetBox!.x + sheetBox!.width)
      expect(run!.y + run!.height, 'Run sits above the bottom edge').toBeLessThanOrEqual(sheetBox!.y + sheetBox!.height)

      const controls: Array<[string, Locator]> = [
        ['Kind', footer(editor, 'kind-dropdown')],
        ['Format', footer(editor, 'format-dropdown')],
        ['F1 Help', footer(editor, 'value-editor-help-chip')],
        ['Could not get fields', chipButton(editor)],
        ['Close', footer(editor, 'value-editor-cancel-button')],
        ['Save', footer(editor, 'value-editor-save-button')],
        ['Run', footer(editor, 'value-editor-run-button')],
      ]
      const lines: Record<string, number> = {}
      for (const [name, control] of controls) lines[name] = await textLines(control)
      expect(lines, `each footer label on one line (${await uiFontNote(page)})`).toEqual(
        Object.fromEntries(controls.map(([name]) => [name, 1])),
      )
      await expectOneRow(controls.map(([, control]) => control))
    })
  })
})
