/**
 * V-CTRL-NOTE-RUN: a run passes a Note on inside every body, section, case and lane
 * Wireframe: none
 * Design Decisions: none
 * REQ: REQ-3.5.1.15, REQ-3.5.1.16, REQ-3.5.1.17, REQ-3.2.2.6, REQ-3.5.1.20, REQ-3.2.3.1, REQ-3.5.1.1
 *
 * Seeds (API): one Test per test through `POST /tests`, built in `note-flows.ts`; each ends in a bookend Log and
 * every Log prints `<name>-<token>`, so the lines read belong to that run alone. Each Test is opened in the
 * Workbench and run with Run.
 *
 * Pass Criteria:
 * 1. For count 2, body Log A, Note, Log B: the console prints A, B, A, B and the run passes.
 * 2. For Each over [1, 2], the same body: A, B, A, B.
 * 3. While `i < 2` (at most 5 rounds), body Note, Setter `i + 1`: the loop ends after its two rounds with no max
 *    iterations line, its then Log prints `count-2` and the run passes.
 * 4. Try/Catch, try section Log A, Note, Log B: A, B; the catch Log never prints.
 * 5. Switch, matching case Log A, Note, Log B: A, B; the default Log never prints.
 * 6. Parallel, lane 1 Log A, Note, Log B and lane 2 one Log: A before B, each once, and the lane 2 Log once.
 * 7. In a For body, an If/Else whose untaken else branch is a Note, then a Log: that Log never prints and paints
 *    skipped on the canvas after the run; the taken branch Log paints success.
 * 8. A For with count 0 whose body is a Note, then a Log: that Log never prints and paints skipped.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { cleanUp } from '../../helpers/fn-block'
import { openTest, validateTest } from '../../helpers/fn-seed'
import { expectLineBefore, formatEntries, type LogEntry } from '../../helpers/log-reader'
import { runToEnd, selectEnvironment } from '../../helpers/workbench'
import {
  IDS,
  forBody,
  forEachBody,
  lines,
  neverRunBody,
  parallelLane,
  switchCase,
  trySection,
  untakenBranch,
  whileBody,
  type NoteGraph,
} from './note-flows'

const CASE_TIMEOUT_MS = 180_000
const MAX_ITERATIONS_LINE = /^\[WHILE\] Max iterations/

const created: string[] = []

function newToken(): string {
  return randomUUID().slice(0, 6)
}

async function seedGraph(request: APIRequestContext, title: string, token: string, graph: NoteGraph): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `zz-note-run ${title} ${token}`,
      version: '1.0.0',
      description: 'A Note inside a body, section, case or lane',
      workflow: { nodes: graph.nodes, edges: graph.edges },
      variables: graph.variables,
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  const testId = (body?.data?.id ?? body?.id) as string
  created.push(testId)
  const validation = await validateTest(request, testId)
  expect(validation.errors, `the seeded Test validates clean: ${JSON.stringify(validation.errors)}`).toEqual([])
  return testId
}

async function runOnCanvas(page: Page, testId: string): Promise<{ verdict: string | null; entries: LogEntry[] }> {
  await openTest(page, testId)
  await selectEnvironment(page)
  return runToEnd(page)
}

/** The console messages that are one of `wanted`, in the order they were printed. */
function printed(entries: readonly LogEntry[], wanted: readonly string[]): string[] {
  const set = new Set(wanted)
  return entries.map((entry) => entry.message).filter((message) => set.has(message))
}

function expectPassed(verdict: string | null, entries: readonly LogEntry[]): void {
  expect(verdict, `the run passes\n${formatEntries(entries)}`).toBe('passed')
}

async function expectPaint(page: Page, blockId: string, status: string, what: string): Promise<void> {
  await expect(page.locator(`[data-testid="workflow-node-${blockId}"]`), what).toHaveAttribute(
    'data-execution-status',
    status,
  )
}

test.describe('V-CTRL-NOTE-RUN: a run passes a Note on', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterEach(async ({ request }) => {
    await cleanUp(request, created)
  })

  test('1. a For body runs on past a Note on every pass', async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const token = newToken()
    const text = lines(token)
    const testId = await seedGraph(page.request, 'for', token, forBody(token))
    const { verdict, entries } = await runOnCanvas(page, testId)

    expect(
      printed(entries, [text.a, text.b]),
      `the For body prints A, then B past the Note, on both passes\n${formatEntries(entries)}`,
    ).toEqual([text.a, text.b, text.a, text.b])
    expectPassed(verdict, entries)
    expect(printed(entries, [text.done]), 'the For then lane runs once').toEqual([text.done])
  })

  test('2. a For Each body runs on past a Note for every item', async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const token = newToken()
    const text = lines(token)
    const testId = await seedGraph(page.request, 'for-each', token, forEachBody(token))
    const { verdict, entries } = await runOnCanvas(page, testId)

    expect(
      printed(entries, [text.a, text.b]),
      `the For Each body prints A, then B past the Note, for both items\n${formatEntries(entries)}`,
    ).toEqual([text.a, text.b, text.a, text.b])
    expectPassed(verdict, entries)
    expect(printed(entries, [text.done]), 'the For Each then lane runs once').toEqual([text.done])
  })

  test('3. a While whose body starts with a Note counts and ends after its rounds', async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const token = newToken()
    const text = lines(token)
    const testId = await seedGraph(page.request, 'while', token, whileBody(token))
    const { verdict, entries } = await runOnCanvas(page, testId)

    expect(
      entries.filter((entry) => MAX_ITERATIONS_LINE.test(entry.message)).map((entry) => entry.message),
      `the Setter past the Note counts every round, so the While never reaches its limit\n${formatEntries(entries)}`,
    ).toEqual([])
    expectPassed(verdict, entries)
    expect(
      printed(entries, [text.count(0), text.count(1), text.count(2), text.count(3), text.count(4), text.count(5)]),
      `the While then lane reads i after two rounds\n${formatEntries(entries)}`,
    ).toEqual([text.count(2)])
    expect(printed(entries, [text.done]), 'the bookend runs once').toEqual([text.done])
  })

  test('4. a Try section runs on past a Note', async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const token = newToken()
    const text = lines(token)
    const testId = await seedGraph(page.request, 'try', token, trySection(token))
    const { verdict, entries } = await runOnCanvas(page, testId)

    expect(
      printed(entries, [text.a, text.b, text.other]),
      `the try section prints A, then B past the Note; the catch section never runs\n${formatEntries(entries)}`,
    ).toEqual([text.a, text.b])
    expectPassed(verdict, entries)
    expect(printed(entries, [text.done]), 'the Try/Catch then lane runs once').toEqual([text.done])
  })

  test('5. a Switch case runs on past a Note', async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const token = newToken()
    const text = lines(token)
    const testId = await seedGraph(page.request, 'switch', token, switchCase(token))
    const { verdict, entries } = await runOnCanvas(page, testId)

    expect(
      printed(entries, [text.a, text.b, text.other]),
      `the matching case prints A, then B past the Note; the default never runs\n${formatEntries(entries)}`,
    ).toEqual([text.a, text.b])
    expectPassed(verdict, entries)
    expect(printed(entries, [text.done]), 'the Switch then lane runs once').toEqual([text.done])
  })

  test('6. a Parallel lane runs on past a Note', async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const token = newToken()
    const text = lines(token)
    const testId = await seedGraph(page.request, 'parallel', token, parallelLane(token))
    const { verdict, entries } = await runOnCanvas(page, testId)

    expect(
      printed(entries, [text.b]),
      `lane 1 runs Log B past the Note\n${formatEntries(entries)}`,
    ).toEqual([text.b])
    expect(printed(entries, [text.a]), 'lane 1 runs Log A once').toEqual([text.a])
    expectLineBefore(entries, text.a, text.b)
    expect(printed(entries, [text.other]), 'lane 2 runs its Log once').toEqual([text.other])
    expectPassed(verdict, entries)
    expect(printed(entries, [text.done]), 'the Parallel then lane runs once').toEqual([text.done])
  })

  test('7. a Log past a Note on an untaken If/Else branch paints skipped', async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const token = newToken()
    const text = lines(token)
    const testId = await seedGraph(page.request, 'untaken-branch', token, untakenBranch(token))
    const { verdict, entries } = await runOnCanvas(page, testId)

    expectPassed(verdict, entries)
    expect(
      printed(entries, [text.taken, text.untaken]),
      `only the taken branch prints\n${formatEntries(entries)}`,
    ).toEqual([text.taken])
    await expectPaint(page, IDS.taken, 'success', 'the taken branch Log paints success')
    await expectPaint(page, IDS.untaken, 'skipped', 'the Log past the Note on the untaken branch paints skipped')
  })

  test('8. a Log past a Note in a body that never runs paints skipped', async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS)
    const token = newToken()
    const text = lines(token)
    const testId = await seedGraph(page.request, 'never-run', token, neverRunBody(token))
    const { verdict, entries } = await runOnCanvas(page, testId)

    expectPassed(verdict, entries)
    expect(printed(entries, [text.untaken]), `the body never runs\n${formatEntries(entries)}`).toEqual([])
    expect(printed(entries, [text.done]), 'the For then lane runs once').toEqual([text.done])
    await expectPaint(page, IDS.untaken, 'skipped', 'the Log past the Note in the body that never ran paints skipped')
  })
})
