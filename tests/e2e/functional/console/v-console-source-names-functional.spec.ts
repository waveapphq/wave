/**
 * V-CONSOLE-SOURCE-NAMES-FUNCTIONAL: the console Source names the block that wrote the line
 * Design Decisions: EXEC-25
 * REQ: REQ-3.4.2.7, REQ-3.7.2.5
 *
 * Pass Criteria:
 * 1. A block whose Name is empty, is its type's palette name or is the catalog's name for the
 *    type writes its lines under the palette name alone (`Log`, `SQL`, `HTTP`)
 * 2. A block with a Name of its own writes them under `{palette name} : {Name}`
 *    (`SQL : Run PSQL Proc`); a SQL block dropped from the palette beside one named `SQL`
 *    writes under `SQL : SQL_1`
 * 3. No Source holds a block's Description, a type id or a block id
 * 4. A Name that holds a colon is shown as typed in the row, in the copied text and in the report
 * 5. The rule holds for a body block on a remote host, a block inside a Function and a loop's
 *    own lines
 * 6. The engine's lines keep `SYSTEM`; a Function's own lines keep `FUNCTION`
 * 7. Stopping a run inside a Function marks the Function `Function : {Name}` and the running
 *    Delay `Delay : {Name}`; a stopped Switch is marked with its palette name, and a stopped
 *    Remote Execution `Remote Execution : {Name}` with its body block under its own Source
 * 8. Loading a Test whose blocks carry a Description writes no `Cannot update a component` line
 * 9. The Level select shows each level's whole word, clear of its arrow
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette } from '../../helpers/canvas'
import {
  HTTP_HEALTH_PORT,
  HTTP_TARGET_HOST,
  K8S_ADMIN_TOKEN,
  K8S_CA_PEM,
} from '../../helpers/config'
import { pickEnum } from '../../helpers/config-sheet'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { fetchSessionReport, finishRun, startRun } from '../../helpers/k8s-run'
import {
  formatEntries,
  getLogCopyTexts,
  getLogRows,
  setConsoleMinimumLevel,
  waitForLogText,
  type LogEntry,
} from '../../helpers/log-reader'
import { setStringParam } from '../../helpers/param-config'
import { clickNodeContextMenuItem, selectEnvironment } from '../../helpers/workbench'
import { openConfig, saveConfig } from '../file-picker/picker'
import {
  closeScriptSheet,
  openScriptSheet,
  saveButton,
  stopRunFromToolbar,
  workflowStatus,
} from '../python-block/editor-helpers'
import { consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

type FixtureNode = {
  id: string
  data: {
    label: string
    elementType: string
    description?: string
    localDefinition?: { description?: string; workflow: { nodes: FixtureNode[] } }
  }
}

type Fixture = {
  name: string
  workflow: { nodes: FixtureNode[] }
  variables: Record<string, { value: unknown }>
}

type OwnLine = {
  row: string
  what: string
  level: string
  message: string | RegExp
  sources: string[]
}

const NAMES_FIXTURE = 'fixture-source-names.json'
const STOP_FIXTURE = 'fixture-source-names-stop.json'
const STOP_SWITCH_FIXTURE = 'fixture-source-names-stop-switch.json'
const STOP_REMOTE_FIXTURE = 'fixture-source-names-stop-remote.json'
const DROP_FIXTURE = 'fixture-source-names-drop.json'

const DONE_LINE = 'src-names-done'
const DELAY_HELD_LINE = 'Delay: waiting 60000 ms'
const REMOTE_HELD_LINE = "Running the script under WAVE's own interpreter on the remote host"
const STOP_LINE = 'Stopped by user'
const RUN_STOPPED_LINE = 'execution stopped by user'
const REACT_WARNING = 'Cannot update a component'

const COLON_SOURCE = 'HTTP : GET http://host/x'
const DROPPED_SOURCE = 'SQL : SQL_1'
const DROPPED_FILE = 'artifact://source-names-dropped.db'
const DROPPED_SQL = 'SELECT 3 AS dropped_three'

const HEALTH_URL = `http://${HTTP_TARGET_HOST}:${HTTP_HEALTH_PORT}/health`
const COLON_LINE = `HTTP GET ${HEALTH_URL}?who=colon (timeout: 30s)`

const LEVELS = ['WARN', 'ERROR', 'FATAL', 'INFO', 'DEBUG']
const LEVEL_TRIGGER_WIDTH_PX = 96
const WIDEST_SOURCE = /width: 50ch/

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// Every Source the names run writes: a Remote Execution writes no line of its own in a run that passes.
const NAMES_RUN_SOURCES = [
  'SYSTEM',
  'FUNCTION',
  'Log',
  'Log : Say hello',
  'HTTP',
  COLON_SOURCE,
  'SQL',
  'SQL : Run PSQL Proc',
  'CSV',
  'Var Setter',
  'Var Setter : Reset the counter',
  'If / Else',
  'Log : On the left path',
  'Switch : Pick a route',
  'Log : In the left case',
  'Try / Catch',
  'Log : Inside the guard',
  'For Loop : Count to two',
  'Log : For body',
  'For Each : Each host',
  'Log : Each body',
  'While Loop : Until done',
  'Var Setter : Add one',
  'Log : Say welcome',
  'SSH Session Open',
  'SSH Session Exec',
  'Python : Count on the host',
  'SSH Session Close',
  'K8s Connect',
  'K8s Get : Read the namespace',
  'Log : Mark the end',
]

const NAMES_RUN_LINES: OwnLine[] = [
  { row: 'Type name alone', what: 'a Log block named Log', level: 'INFO', message: 'src-palette-name', sources: ['Log'] },
  { row: 'Type name alone', what: 'a Log block with an empty Name', level: 'INFO', message: 'src-empty-name', sources: ['Log'] },
  {
    row: 'Type name alone',
    what: 'an HTTP block named HTTP Client',
    level: 'INFO',
    message: `HTTP GET ${HEALTH_URL}?who=catalog (timeout: 30s)`,
    sources: ['HTTP'],
  },
  {
    row: 'Type name alone',
    what: 'a SQL block named SQL',
    level: 'DEBUG',
    message: /^Inputs: \{.*"sql":"SELECT 1 AS plain_one".*\}$/,
    sources: ['SQL'],
  },
  {
    row: 'Type and Name',
    what: 'a SQL block named Run PSQL Proc',
    level: 'DEBUG',
    message: /^Inputs: \{.*"sql":"SELECT 2 AS proc_two".*\}$/,
    sources: ['SQL : Run PSQL Proc'],
  },
  {
    row: 'Type and Name',
    what: 'the two SQL blocks connecting',
    level: 'INFO',
    message: /^Connected to SQLite \S+ at .+source-names\.db$/,
    sources: ['SQL', 'SQL : Run PSQL Proc'],
  },
  { row: 'Type and Name', what: 'a Log block named Say hello', level: 'INFO', message: 'src-own-name', sources: ['Log : Say hello'] },
  {
    row: 'Palette names',
    what: 'a CSV block named CSV Parser',
    level: 'DEBUG',
    message: /^Outputs: \{"table":"Table\(\[id, name\], 2 rows\)","row_count":2,/,
    sources: ['CSV'],
  },
  {
    row: 'Palette names',
    what: 'a Var Setter block named Variable Setter',
    level: 'DEBUG',
    message: "Set variable 'route' = 'left' (scope: test)",
    sources: ['Var Setter'],
  },
  {
    row: 'Palette names',
    what: 'a Var Setter block named Reset the counter',
    level: 'DEBUG',
    message: "Set variable 'counter' = 0 (scope: test)",
    sources: ['Var Setter : Reset the counter'],
  },
  { row: 'Palette names', what: 'an If / Else block named If/Else', level: 'INFO', message: 'Branch taken: Left', sources: ['If / Else'] },
  {
    row: 'Palette names',
    what: 'a Switch block named Pick a route',
    level: 'INFO',
    message: 'Branch taken: left',
    sources: ['Switch : Pick a route'],
  },
  {
    row: 'Palette names',
    what: 'a Try / Catch block named Try/Catch/Finally',
    level: 'INFO',
    message: 'Try/Catch: catch=True, finally=False',
    sources: ['Try / Catch'],
  },
  {
    row: 'Palette names',
    what: 'an SSH Session Exec block that keeps its Name',
    level: 'DEBUG',
    message: 'Outputs: {"stdout":"src-ssh-exec\\n","stderr":"","exit_code":0}',
    sources: ['SSH Session Exec'],
  },
  {
    row: 'Palette names',
    what: 'a K8s Get block named Read the namespace',
    level: 'INFO',
    message: 'Read 1 Namespace object(s) from /api/v1/namespaces/default',
    sources: ['K8s Get : Read the namespace'],
  },
  { row: 'Colon in a Name', what: 'an HTTP block named GET http://host/x', level: 'INFO', message: COLON_LINE, sources: [COLON_SOURCE] },
  {
    row: 'Remote body, Function body, loops',
    what: 'a Python block in a Remote Execution body, starting on the remote host',
    level: 'INFO',
    message: "Running the script under WAVE's own interpreter on the remote host",
    sources: ['Python : Count on the host'],
  },
  {
    row: 'Remote body, Function body, loops',
    what: 'the same Python block printing on the remote host',
    level: 'INFO',
    message: 'src-remote-body',
    sources: ['Python : Count on the host'],
  },
  { row: 'Remote body, Function body, loops', what: 'a Log block inside a Function', level: 'INFO', message: 'src-function-body', sources: ['Log : Say welcome'] },
  {
    row: 'Remote body, Function body, loops',
    what: 'a For Loop named Count to two',
    level: 'INFO',
    message: 'For loop: mode=count, iterations=2, step=1',
    sources: ['For Loop : Count to two'],
  },
  {
    row: 'Remote body, Function body, loops',
    what: 'a While Loop named Until done',
    level: 'INFO',
    message: 'While loop: mode=while-do',
    sources: ['While Loop : Until done'],
  },
  {
    row: 'Remote body, Function body, loops',
    what: 'the three loops ending',
    level: 'DEBUG',
    message: 'Loop completed',
    sources: ['For Each : Each host', 'For Loop : Count to two', 'While Loop : Until done'],
  },
  {
    row: 'System lines',
    what: 'the engine starting the run',
    level: 'INFO',
    message: /^Test 'Console Source Names \S+' execution started \(\d+ blocks\)$/,
    sources: ['SYSTEM'],
  },
  { row: 'System lines', what: 'the engine entering a block', level: 'DEBUG', message: "Executing 'Say hello' (plugin/log)", sources: ['SYSTEM'] },
  {
    row: 'System lines',
    what: 'the engine ending the run',
    level: 'INFO',
    message: /^Test 'Console Source Names \S+' completed successfully$/,
    sources: ['SYSTEM'],
  },
  { row: 'System lines', what: 'a Function entering', level: 'INFO', message: "Entering Function 'Sign in'", sources: ['FUNCTION'] },
  {
    row: 'System lines',
    what: 'a Function ending',
    level: 'INFO',
    message: "Function 'Sign in' completed with status passed",
    sources: ['FUNCTION'],
  },
]

function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
}

function importable(fixture: Fixture): Record<string, unknown> {
  return fixture as unknown as Record<string, unknown>
}

/** Every block of a Test, the ones inside a Function body included. */
function allNodes(fixture: Fixture): FixtureNode[] {
  const walk = (nodes: FixtureNode[]): FixtureNode[] =>
    nodes.flatMap((node) => [node, ...walk(node.data.localDefinition?.workflow.nodes ?? [])])
  return walk(fixture.workflow.nodes)
}

function nodeNamed(fixture: Fixture, name: string): FixtureNode {
  const found = allNodes(fixture).find((node) => node.data.label === name)
  expect(found, `the fixture holds a block named "${name}"`).toBeTruthy()
  return found as FixtureNode
}

function descriptionsOf(fixture: Fixture): string[] {
  return allNodes(fixture)
    .flatMap((node) => [node.data.description, node.data.localDefinition?.description])
    .filter((text): text is string => Boolean(text))
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b))
}

function distinctSources(entries: readonly LogEntry[]): string[] {
  return sorted([...new Set(entries.map((entry) => entry.source))])
}

function isLine(entry: LogEntry, level: string, message: string | RegExp): boolean {
  if (entry.level !== level) return false
  return typeof message === 'string' ? entry.message === message : message.test(entry.message)
}

function sourcesOf(entries: readonly LogEntry[], level: string, message: string | RegExp): string[] {
  return sorted(entries.filter((entry) => isLine(entry, level, message)).map((entry) => entry.source))
}

function expectOwnLines(entries: readonly LogEntry[], lines: readonly OwnLine[]): void {
  for (const line of lines) {
    expect(
      sourcesOf(entries, line.level, line.message),
      `${line.row}: the Source of ${line.what}.\n${formatEntries(entries)}`,
    ).toEqual(sorted(line.sources))
  }
}

/** The console rows, read from each row's copy text, which keeps the whole Source. */
async function consoleEntries(page: Page): Promise<LogEntry[]> {
  const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
  expect(
    entries.filter((entry) => entry.level === '').map((entry) => entry.message),
    'every console row copies as time, level, [source] and message',
  ).toEqual([])
  return entries
}

function unescapeHtml(text: string): string {
  return text
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/** The log rows of an exported report. */
function reportEntries(report: string): LogEntry[] {
  const row =
    /<td class="rpt-col-lvl">([^<]*)<\/td><td class="rpt-col-src">([^<]*)<\/td><td class="rpt-col-msg">([\s\S]*?)<\/td>/g
  return [...report.matchAll(row)].map((cells) => ({
    level: unescapeHtml(cells[1]),
    source: unescapeHtml(cells[2]),
    message: unescapeHtml(cells[3]).trim(),
  }))
}

function watchBrowserConsole(page: Page): string[] {
  const lines: string[] = []
  page.on('console', (message) => lines.push(message.text()))
  page.on('pageerror', (error) => lines.push(error.message))
  return lines
}

function reactWarnings(lines: readonly string[]): string[] {
  return lines.filter((line) => line.includes(REACT_WARNING))
}

/** Drag the Source column's handle far right, to the widest the column goes. */
async function widenSourceColumn(page: Page): Promise<void> {
  const handle = page.locator('[data-testid="source-resize-handle"]')
  const cell = page.locator('[data-testid="log-entry-source"]').first()
  await expect(async () => {
    const box = await handle.boundingBox()
    expect(box, 'the Source column has its drag handle').not.toBeNull()
    const x = box!.x + box!.width / 2
    const y = box!.y + box!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // The drag listens on the document only once the press has been committed.
    await page.waitForTimeout(80)
    await page.mouse.move(x + 600, y, { steps: 12 })
    await page.mouse.up()
    await expect(cell).toHaveAttribute('style', WIDEST_SOURCE, { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/** A point on the canvas, as the palette drop takes it, a block's width or more away from every block. */
async function freeCanvasSpot(page: Page): Promise<{ x: number; y: number }> {
  await expandPalette(page)
  const canvas = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  expect(canvas, 'the canvas is on screen').not.toBeNull()
  const blocks = await page.locator('.react-flow__node').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
    }),
  )
  const candidates = [
    [0.15, 0.5],
    [0.85, 0.5],
    [0.15, 0.25],
    [0.85, 0.25],
  ].map(([fx, fy]) => ({ x: Math.round(canvas!.width * fx), y: Math.round(canvas!.height * fy) }))
  const free = candidates.find((spot) => {
    const px = canvas!.x + spot.x
    const py = canvas!.y + spot.y
    return blocks.every((box) => {
      const reachX = box.right - box.left + 40
      const reachY = box.bottom - box.top + 40
      return px < box.left - reachX || px > box.right + reachX || py < box.top - reachY || py > box.bottom + reachY
    })
  })
  expect(free, `a free spot on the canvas among ${JSON.stringify(blocks)}`).toBeTruthy()
  return free as { x: number; y: number }
}

/** Start a run, wait for the line its held block writes, stop it from the toolbar and read the console. */
async function stopWhileHeld(
  page: Page,
  file: string,
  heldLine: string,
): Promise<{ fixture: Fixture; entries: LogEntry[] }> {
  const fixture = loadFixture(file)
  await importValidateAndNavigate(page, importable(fixture), { injectSsh: true, rejectRepairs: true })
  await setConsoleMinimumLevel(page, 'DEBUG')
  await startRun(page)
  await waitForLogText(page, heldLine, 60_000)
  await stopRunFromToolbar(page)
  await waitForLogText(page, RUN_STOPPED_LINE, 15_000)
  return { fixture, entries: await consoleEntries(page) }
}

function stoppedMarks(entries: readonly LogEntry[]): string[] {
  return sorted(
    entries.filter((entry) => entry.message === STOP_LINE).map((entry) => `${entry.level} ${entry.source}`),
  )
}

/** Console rows that show a block's id in their Source or their message. */
function rowsShowingAnId(fixture: Fixture, entries: readonly LogEntry[]): LogEntry[] {
  const ids = allNodes(fixture).map((node) => node.id)
  return entries.filter(
    (entry) =>
      UUID.test(entry.source) || ids.some((id) => entry.source.includes(id) || entry.message.includes(id)),
  )
}

test.describe('V-CONSOLE-SOURCE-NAMES-FUNCTIONAL: the console Source names the block', () => {
  test('every block writes its lines under its type and its Name', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    const browserLines = watchBrowserConsole(page)

    const fixture = loadFixture(NAMES_FIXTURE)
    fixture.variables.k8s_ca.value = K8S_CA_PEM
    fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
    await importValidateAndNavigate(page, importable(fixture), {
      injectSsh: true,
      injectHttp: true,
      rejectRepairs: true,
    })

    await test.step('the Test loads with no React warning', async () => {
      const described = nodeNamed(fixture, 'Run PSQL Proc')
      await expect(
        page.locator(`[data-testid="workflow-node-${described.id}"] [data-testid="node-description"]`),
        'the block shows its Description on the canvas',
      ).toContainText(described.data.description as string)
      expect(reactWarnings(browserLines)).toEqual([])
    })

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    await finishRun(page, status, DONE_LINE)
    const entries = await consoleEntries(page)

    await test.step('each line carries the Source of the block that wrote it', () => {
      expectOwnLines(entries, NAMES_RUN_LINES)
    })

    await test.step('every Source is a palette name, with the Name after it when the block has its own', () => {
      const sources = distinctSources(entries)
      expect(sources, `the Sources of the run.\n${formatEntries(entries)}`).toEqual(sorted(NAMES_RUN_SOURCES))
      const typeIds = [...new Set(allNodes(fixture).map((node) => node.data.elementType))].filter((id) =>
        id.includes('-'),
      )
      expect(
        sources.filter((source) => typeIds.some((id) => source.toLowerCase().includes(id))),
        'no Source reads a type id',
      ).toEqual([])
      expect(rowsShowingAnId(fixture, entries).map((entry) => entry.source), 'no Source reads a block id').toEqual([])
    })

    await test.step('no Source holds a Description', () => {
      const descriptions = descriptionsOf(fixture)
      expect(descriptions.length, 'the fixture describes its blocks').toBeGreaterThan(20)
      expect(
        distinctSources(entries).filter((source) => descriptions.some((text) => source.includes(text))),
      ).toEqual([])
    })

    await test.step('the row shows a Name with a colon as typed, as the copied text does', async () => {
      await widenSourceColumn(page)
      const rows = await getLogRows(page)
      expect(
        rows.filter((row) => row.level === 'INFO' && row.message === COLON_LINE).map((row) => row.source),
        'the Source cell of the HTTP block named GET http://host/x',
      ).toEqual([COLON_SOURCE])
      expect(
        sorted(rows.map((row) => row.source)),
        'each row shows the Source it copies',
      ).toEqual(sorted(entries.map((entry) => entry.source)))
    })

    await test.step('the report shows the same Sources', async () => {
      const reported = reportEntries(await fetchSessionReport(page))
      expect(sourcesOf(reported, 'INFO', COLON_LINE)).toEqual([COLON_SOURCE])
      expect(distinctSources(reported)).toEqual(sorted(NAMES_RUN_SOURCES))
    })

    await test.step('the run ends with no React warning', () => {
      expect(reactWarnings(browserLines)).toEqual([])
    })
  })

  test('a SQL block dropped beside one named SQL writes under SQL : SQL_1', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    const fixture = loadFixture(DROP_FIXTURE)
    await importValidateAndNavigate(page, importable(fixture), { rejectRepairs: true })
    await getLogCopyTexts(page)
    await selectEnvironment(page)

    let droppedId = ''
    await test.step('the dropped block takes the Name SQL_1', async () => {
      await dragPaletteItemToCanvas(page, 'sql', await freeCanvasSpot(page))
      const dropped = page.locator('[data-testid^="workflow-node-body-"]').filter({ hasText: /^SQL_1$/ })
      await expect(dropped).toHaveCount(1)
      droppedId = ((await dropped.getAttribute('data-testid')) ?? '').replace('workflow-node-body-', '')
      expect(droppedId, 'the dropped block has an id of its own').not.toBe(nodeNamed(fixture, 'SQL').id)
    })

    await test.step('the dropped block is set to read a SQLite file', async () => {
      const dialog = await openConfig(page, droppedId)
      await pickEnum(page, dialog, 'database_type', 'SQLite')
      await setStringParam(dialog, page, 'file', DROPPED_FILE)
      const sheet = await openScriptSheet(page, dialog, 'sql')
      const editor = sheet.locator('.cm-content').first()
      await editor.click()
      await page.keyboard.insertText(DROPPED_SQL)
      await expect(editor).toHaveText(DROPPED_SQL)
      await leaveExpressionEditor(sheet)
      await saveButton(sheet).click()
      await expect(saveButton(sheet)).toBeDisabled()
      await closeScriptSheet(page, sheet)
      await saveConfig(dialog)
    })

    await test.step('its lines carry SQL : SQL_1', async () => {
      await clickNodeContextMenuItem(page, droppedId, 'Run Current')
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', { timeout: 60_000 })
      await waitForLogText(page, 'Statement 1: 1 rows', 15_000)
      const entries = await consoleEntries(page)
      expect(
        sourcesOf(entries, 'INFO', /^Connected to SQLite \S+ at .+source-names-dropped\.db$/),
        `the dropped block connects under its own Source.\n${formatEntries(entries)}`,
      ).toEqual([DROPPED_SOURCE])
      expect(sourcesOf(entries, 'INFO', /^Statement 1: 1 rows, \d+ ms$/)).toEqual([DROPPED_SOURCE])
      expect(
        distinctSources(entries).filter((source) => source !== 'SYSTEM'),
        'only the dropped block wrote lines',
      ).toEqual([DROPPED_SOURCE])
    })
  })

  test('stopping a run inside a Function marks the Function and the running Delay', async ({ page }) => {
    const { fixture, entries } = await stopWhileHeld(page, STOP_FIXTURE, DELAY_HELD_LINE)

    await test.step('one stopped mark for the Function and one for the Delay', () => {
      expect(stoppedMarks(entries), `the stopped marks.\n${formatEntries(entries)}`).toEqual([
        'WARN Delay : Wait for the login',
        'WARN Function : Open the portal',
      ])
    })

    await test.step('no line shows a block id', () => {
      expect(formatEntries(rowsShowingAnId(fixture, entries))).toBe('')
    })

    await test.step("the Function's own line and the engine's line keep their Source", () => {
      expect(sourcesOf(entries, 'INFO', "Entering Function 'Open the portal'")).toEqual(['FUNCTION'])
      expect(
        sourcesOf(entries, 'WARN', /^Test 'Console Source Names Stop \S+' execution stopped by user$/),
      ).toEqual(['SYSTEM'])
    })
  })

  test('a stopped Switch is marked with its palette name', async ({ page }) => {
    const { fixture, entries } = await stopWhileHeld(page, STOP_SWITCH_FIXTURE, DELAY_HELD_LINE)

    await test.step('a Switch named Switch/Case is marked Switch', () => {
      expect(stoppedMarks(entries), `the stopped marks.\n${formatEntries(entries)}`).toEqual([
        'WARN Delay : Hold the case',
        'WARN Switch',
      ])
    })

    await test.step('no Source reads a type id or a block id', () => {
      expect(distinctSources(entries)).toEqual(
        sorted(['SYSTEM', 'Switch', 'Log : Before the hold', 'Delay : Hold the case']),
      )
      expect(formatEntries(rowsShowingAnId(fixture, entries))).toBe('')
    })
  })

  test('a stopped Remote Execution is marked with its type and Name', async ({ page }) => {
    const { fixture, entries } = await stopWhileHeld(page, STOP_REMOTE_FIXTURE, REMOTE_HELD_LINE)

    await test.step('EXEC-25: one stopped mark for the container and one for its body block', () => {
      expect(stoppedMarks(entries), `the stopped marks.\n${formatEntries(entries)}`).toEqual([
        'WARN Python : Hold on the host',
        'WARN Remote Execution : On the far host',
      ])
    })

    await test.step('the body block wrote its own line under the same Source', () => {
      expect(sourcesOf(entries, 'INFO', REMOTE_HELD_LINE)).toEqual(['Python : Hold on the host'])
      expect(formatEntries(rowsShowingAnId(fixture, entries))).toBe('')
    })
  })

  test('the Level select shows each level whole', async ({ page }) => {
    await importValidateAndNavigate(page, importable(loadFixture(DROP_FIXTURE)), { rejectRepairs: true })
    const trigger = page.locator('button[aria-label="Minimum log level"]')

    for (const level of LEVELS) {
      await test.step(`the trigger reads ${level}, clear of the arrow`, async () => {
        await setConsoleMinimumLevel(page, level)
        await expect(trigger).toHaveText(level)
        await expect
          .poll(async () => Math.round(((await trigger.boundingBox())?.width ?? 0) * 10) / 10, {
            message: 'the trigger is 96 px wide',
          })
          .toBe(LEVEL_TRIGGER_WIDTH_PX)
        const fit = await trigger.evaluate((button) => {
          const value = button.querySelector('span') as HTMLElement
          const arrow = button.querySelector('svg') as SVGElement
          const range = document.createRange()
          range.selectNodeContents(value)
          const text = range.getBoundingClientRect()
          const box = value.getBoundingClientRect()
          return {
            word: value.textContent,
            textLeft: text.left,
            textRight: text.right,
            boxLeft: box.left,
            boxRight: box.right,
            arrowLeft: arrow.getBoundingClientRect().left,
            cutOff: value.scrollWidth - value.clientWidth,
          }
        })
        expect(fit.word).toBe(level)
        expect(fit.cutOff, `no part of ${level} is cut off`).toBeLessThanOrEqual(0)
        expect(fit.textLeft, `${level} starts inside its box`).toBeGreaterThanOrEqual(fit.boxLeft - 0.5)
        expect(fit.textRight, `${level} ends inside its box`).toBeLessThanOrEqual(fit.boxRight + 0.5)
        expect(fit.textRight, `${level} ends before the arrow`).toBeLessThanOrEqual(fit.arrowLeft)
      })
    }
  })
})
