/**
 * V-WATCH-MCP-AMEND-FUNCTIONAL: an assistant's watched change of a saved test over the real MCP
 * endpoint. `amend_test_live_from_recipe` holds the workbench session, plays the change in every
 * tab that has the session, saves once and hands the session back to the tab that gave way.
 * Design Decisions: WATCH-1, WATCH-8, WATCH-9, RUNM-2, RUNM-6
 * REQ: REQ-5.2.7.16, REQ-5.2.7.17, REQ-5.2.7.18
 *
 * The stored test is Alpha, Bravo (with its own recipe key) and a Delay. The change keeps Alpha,
 * adds a Log after it, renames Bravo with a new message and removes the Delay.
 *
 * Pass Criteria:
 *  1. A tab holding the test and a watching tab, both panned away first, show the same play under
 *     the assistant's banner reading "read-only, changing live": step one with Alpha and Bravo at
 *     their final places (Bravo moved down to make room, Alpha did not move), the Delay gone, only
 *     the line from Start to Alpha, nothing new, no steady border and no ring; then the new Log at
 *     its final place with its line from Alpha, carrying the steady border and the ring; then
 *     Bravo under its new name with its line from the new Log, carrying both; then the saved test
 *     with no border. No other Block rings. Step one frames the finished test (every Block and
 *     the Start node in view) and the view does not move again.
 *  2. The change answers like the fast amend (amended, the test, version 1.1.0, no warnings,
 *     repairs or action items), and the stored test is that answer: Alpha and Bravo keep their
 *     ids, the new Log has an id no stored Block had, the Delay is gone, and the lines run Start,
 *     Alpha, new Log, Bravo.
 *  3. The tab that gave way ends holding the session with no dialog, showing the saved test,
 *     clean (Save disabled); the watching tab ends watching it under the person banner.
 *  4. A tab that gave way with another test open switches to the test being changed at step one,
 *     plays the same turns, and ends holding the session on it, saved and clean; the other test
 *     is untouched in storage.
 *  5. A holder with unsaved edits refuses the watched change with SESSION_HELD and its exact
 *     text: nothing streams (the assistant's banner never shows), nothing is written, and the tab
 *     keeps its edits and the session.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/watch-mode/v-watch-mcp-amend-functional.spec.ts
 */

import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { dragPaletteItemToCanvas } from '../../helpers/canvas'
import { cleanUp, storedTest } from '../../helpers/fn-block'
import {
  callToolAsync,
  enableMcpUntilRestart,
  resetMcpSettings,
  type McpToolResult,
} from '../../helpers/mcp'
import { SEL, nodeIds, ownershipState, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import {
  contentStates,
  importFixture,
  loadFixture,
  lookAway,
  openHolder,
  openWatcher,
  recordView,
  sameContent,
  trackDirtyReport,
  viewSamples,
  type ContentState,
  type ViewSample,
} from './helpers'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765
const WATCHED_CHANGE = 'amend_test_live_from_recipe'
const SAVE_BUTTON = '[data-testid="toolbar-save-button"]'
const BREADCRUMB = '[data-testid="breadcrumb-path"]'
const CHANGING_LIVE = 'read-only, changing live'
const STORED_IDS = ['node-1', 'node-2', 'node-3']
const STORED_BLOCKS = ['node-1=Alpha', 'node-2=Bravo', 'node-3=Pause']
const OTHER_BLOCKS = ['fn-1=Function_1', 'top-a=Log']
const SESSION_HELD = {
  step: 'test',
  code: 'SESSION_HELD',
  severity: 'error',
  problem: 'The workbench session is already held',
  fix: 'Another editor currently holds the workbench session. Ask them to release it or hand it over, then retry.',
}

interface StoredBlock {
  id: string
  data: { label: string; config: { values: Record<string, unknown> } }
}

interface StoredWorkflowTest {
  name: string
  version: string
  workflow: { nodes: StoredBlock[]; edges: { source: string; target: string }[] }
}

/** What the watched change saved, read back from storage. */
interface SavedChange {
  inserted: string
  blocks: string[]
  lines: string[]
}

/** The states of a tab that played the change, from the sample before the assistant's banner on. */
interface Play {
  before: ViewSample
  stepOne: ContentState
  insertTurn: ContentState
  renameTurn: ContentState
  saved: ContentState
}

const open: BrowserContext[] = []
const track = (context: BrowserContext): void => {
  open.push(context)
}
const created: string[] = []

/** Keep Alpha, add a Log after it, rename Bravo (its key keeps it the same Block) with a new message, drop the Delay. */
function changeRecipe(name: string): string {
  return [
    'test:',
    `  name: ${JSON.stringify(name)}`,
    '  description: Watched change',
    'flow:',
    '  - block: log',
    '    label: Alpha',
    '    settings: {message: alpha}',
    '  - block: log',
    '    label: Inserted',
    '    settings: {message: inserted}',
    '  - block: log',
    '    label: Bravo Revised',
    '    key: bravo',
    '    settings: {message: bravo-revised}',
    '',
  ].join('\n')
}

async function stored(request: APIRequestContext, testId: string): Promise<StoredWorkflowTest> {
  return (await storedTest(request, testId)) as unknown as StoredWorkflowTest
}

function blocksOf(saved: StoredWorkflowTest): string[] {
  return saved.workflow.nodes.map((node) => `${node.id}=${node.data.label}`).sort()
}

function linesOf(saved: StoredWorkflowTest): string[] {
  return saved.workflow.edges.map((edge) => `${edge.source}>${edge.target}`).sort()
}

/** Import the test the change rewrites; returns its id and name. */
async function seedChangeTest(request: APIRequestContext): Promise<{ testId: string; name: string }> {
  const testId = await importFixture(request, loadFixture('fixture-change.json'))
  created.push(testId)
  const seeded = await stored(request, testId)
  expect(blocksOf(seeded)).toEqual(STORED_BLOCKS)
  return { testId, name: seeded.name }
}

function startChange(testId: string, name: string): Promise<McpToolResult> {
  return callToolAsync(MCP_PORT, WATCHED_CHANGE, { test_ref: testId, recipe: changeRecipe(name) })
}

/** The answer is the fast amend's, and the stored test is that answer. */
async function expectSavedChange(
  request: APIRequestContext,
  result: McpToolResult,
  testId: string,
  name: string,
): Promise<SavedChange> {
  expect(result.isError, JSON.stringify(result.payload)).toBe(false)
  expect(result.payload, 'the watched change answers like the fast amend').toEqual({
    amended: true,
    test_id: testId,
    name,
    version: '1.1.0',
    warnings: [],
    repairs: [],
    action_items: [],
  })
  const saved = await stored(request, testId)
  expect({ name: saved.name, version: saved.version }).toEqual({ name, version: '1.1.0' })
  expect(saved.workflow.nodes).toHaveLength(3)
  const byName = Object.fromEntries(
    saved.workflow.nodes.map((node) => [node.data.label, { id: node.id, message: node.data.config.values.message }]),
  )
  const inserted = String(byName.Inserted?.id)
  expect(STORED_IDS, 'the new Log has an id no stored Block had').not.toContain(inserted)
  expect(byName, 'Alpha and Bravo keep their ids and the Delay is gone').toEqual({
    Alpha: { id: 'node-1', message: 'alpha' },
    Inserted: { id: inserted, message: 'inserted' },
    'Bravo Revised': { id: 'node-2', message: 'bravo-revised' },
  })
  const lines = linesOf(saved)
  expect(lines).toEqual([`${inserted}>node-2`, `node-1>${inserted}`, 'start-node>node-1'].sort())
  return { inserted, blocks: blocksOf(saved), lines }
}

/** Wait until the tab's latest frame shows these Blocks and lines. */
async function settledOn(page: Page, blocks: string[], lines: string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const last = (await viewSamples(page)).at(-1)
        return { blocks: last?.blocks, lines: last?.lines }
      },
      { timeout: 15_000 },
    )
    .toEqual({ blocks, lines })
}

/** The tab that gave way holds the session again, on the saved test, clean, with no dialog. */
async function expectHoldsSaved(
  tab: Page,
  request: APIRequestContext,
  holderId: string,
  saved: SavedChange,
): Promise<void> {
  await expect
    .poll(async () => (await ownershipState(request)).holder?.id, { timeout: 15_000 })
    .toBe(holderId)
  await expect(tab.locator(SEL.banner)).toHaveCount(0)
  await expect(tab.locator(SEL.canvasReadOnly)).toHaveCount(0)
  await expect(tab.locator(SAVE_BUTTON)).toBeDisabled()
  await expect(tab.getByRole('alertdialog')).toHaveCount(0)
  await settledOn(tab, saved.blocks, saved.lines)
}

function settled(state: ContentState): ViewSample {
  return state.samples[state.samples.length - 1]
}

/** The play every tab with the session shows: step one, the new Log's turn, Bravo's turn, the saved test. */
function expectPlay(samples: ViewSample[], saved: SavedChange): Play {
  const detail = JSON.stringify(samples)
  const { inserted } = saved
  const claimed = samples.findIndex((sample) => sample.watchingMcp)
  expect(claimed, `the assistant's banner shows after recording began: ${detail}`).toBeGreaterThan(0)
  const before = samples[claimed - 1]
  // Until step one lands, the tab still shows what it showed before the claim.
  const states = contentStates(samples.slice(claimed)).filter(
    (state, index) => index > 0 || !sameContent(state, before),
  )
  const turned = ['node-1=Alpha', 'node-2=Bravo Revised', `${inserted}=Inserted`].sort()
  expect(
    states.map(({ blocks, active }) => ({ blocks, active })),
    `step one, one turn per new or changed Block in flow order, then the saved test: ${detail}`,
  ).toEqual([
    { blocks: ['node-1=Alpha', 'node-2=Bravo'], active: null },
    { blocks: ['node-1=Alpha', 'node-2=Bravo', `${inserted}=Inserted`].sort(), active: inserted },
    { blocks: turned, active: 'node-2' },
    { blocks: turned, active: null },
  ])
  const [stepOne, insertTurn, renameTurn, savedState] = states

  expect(settled(stepOne).lines, 'step one keeps only the line from Start to Alpha').toEqual(['start-node>node-1'])
  expect(settled(insertTurn).lines, 'the new Log comes with its line from Alpha').toEqual(
    [`node-1>${inserted}`, 'start-node>node-1'].sort(),
  )
  expect(settled(renameTurn).lines, "Bravo's turn brings its line from the new Log").toEqual(saved.lines)
  expect(settled(savedState).lines).toEqual(saved.lines)

  const final = settled(savedState).places
  expect(settled(stepOne).places, 'step one shows the Blocks that stay at their final places').toEqual({
    'node-1': final['node-1'],
    'node-2': final['node-2'],
  })
  expect(settled(insertTurn).places[inserted], 'the new Log lands at its final place').toBe(final[inserted])

  const fromStepOne = samples.indexOf(stepOne.samples[0])
  const carried = samples[fromStepOne - 1].ring
  const rings = [...new Set(samples.slice(fromStepOne).map((sample) => sample.ring))].filter(
    (ring): ring is string => ring !== null && ring !== carried,
  )
  expect(
    rings.map((ring) => ring.split('#')[0]),
    `one ring per turn, on its Block, and none in step one or after: ${detail}`,
  ).toEqual([inserted, 'node-2'])

  for (const sample of [...stepOne.samples, ...insertTurn.samples, ...renameTurn.samples]) {
    expect(sample.watchingMcp, `the change plays under the assistant's banner: ${detail}`).toBe(true)
  }
  const named = samples.slice(samples.indexOf(settled(stepOne))).filter((sample) => sample.watchingMcp)
  for (const sample of named) expect(sample.banner, detail).toContain(CHANGING_LIVE)
  for (const state of states) {
    expect(settled(state).allInView, `every Block is in view: ${detail}`).toBe(true)
  }
  return { before, stepOne, insertTurn, renameTurn, saved: savedState }
}

/** Step one frames the finished test from where the tab looked, and the view does not move again. */
function expectFramed(samples: ViewSample[], play: Play): void {
  const detail = JSON.stringify(samples)
  const framed = settled(play.stepOne).transform
  expect(framed, `step one moves the view to frame the finished test: ${detail}`).not.toBe(play.before.transform)
  for (const sample of samples.slice(samples.indexOf(play.stepOne.samples[0]))) {
    expect([play.before.transform, framed], detail).toContain(sample.transform)
  }
  for (const sample of samples.slice(samples.indexOf(play.insertTurn.samples[0]))) {
    expect(sample.transform, detail).toBe(framed)
  }
  const end = settled(play.saved)
  expect(end.allInView && end.startInView, `the view holds every Block and the Start node: ${detail}`).toBe(true)
}

test.describe('V-WATCH-MCP-AMEND-FUNCTIONAL: watched change of a saved test over MCP', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
    await cleanUp(request, created)
    await resetMcpSettings(page)
  })

  test('the change plays step one, then one turn per Block, in the tab that gives way and in a watcher, and hands the saved test back', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const { testId, name } = await seedChangeTest(request)

    const holder = await openHolder(browser, testId, track)
    await expect.poll(async () => (await nodeIds(holder)).sort()).toEqual(STORED_IDS)
    const watcher = await openWatcher(browser, track)
    await expect(watcher.locator(SEL.bannerPerson)).toBeVisible()
    await expect.poll(async () => (await nodeIds(watcher)).sort()).toEqual(STORED_IDS)
    const gaveWay = await waitUntilHeld(request)
    expect(gaveWay.kind).toBe('person')
    await lookAway(holder)
    await lookAway(watcher)

    const saved = await expectSavedChange(request, await startChange(testId, name), testId, name)

    await test.step('the tab that gave way holds the saved test again; the watcher watches it', async () => {
      await expectHoldsSaved(holder, request, gaveWay.id, saved)
      await expect(watcher.locator(SEL.bannerPerson)).toBeVisible()
      await settledOn(watcher, saved.blocks, saved.lines)
    })

    for (const [tab, role] of [
      [holder, 'the tab that gave way'],
      [watcher, 'the watching tab'],
    ] as const) {
      await test.step(`${role} played the change and framed the finished test`, async () => {
        const samples = await viewSamples(tab)
        const play = expectPlay(samples, saved)
        expect(play.before.blocks, 'the tab showed the stored test before the change').toEqual(STORED_BLOCKS)
        const final = settled(play.saved).places
        expect(play.before.places['node-1'], 'Alpha keeps its place').toBe(final['node-1'])
        expect(play.before.places['node-2'], 'Bravo moves down to make room for the new Log').not.toBe(
          final['node-2'],
        )
        expectFramed(samples, play)
      })
    }
  })

  test('a tab that gave way with another test open switches to the changed test and ends holding it, saved', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const otherId = await importFixture(request, loadFixture('fixture-follow.json'))
    created.push(otherId)
    const other = await stored(request, otherId)
    const { testId, name } = await seedChangeTest(request)

    const tab = await openHolder(browser, otherId, track)
    await expect.poll(async () => (await nodeIds(tab)).sort()).toEqual(['fn-1', 'top-a'])
    await expect(tab.locator(BREADCRUMB)).toContainText(other.name)
    const gaveWay = await waitUntilHeld(request)
    expect(gaveWay.kind).toBe('person')
    await recordView(tab)
    await expect.poll(async () => (await viewSamples(tab)).length).toBeGreaterThan(0)

    const saved = await expectSavedChange(request, await startChange(testId, name), testId, name)

    await test.step('the tab holds the changed test, saved and clean', async () => {
      await expectHoldsSaved(tab, request, gaveWay.id, saved)
      await expect(tab.locator(BREADCRUMB)).toContainText(name)
      await expect(tab.locator(BREADCRUMB)).not.toContainText(other.name)
    })

    await test.step('step one switched the tab from the other test to the changed one', async () => {
      const play = expectPlay(await viewSamples(tab), saved)
      expect(play.before.blocks, 'the tab showed the other test before the change').toEqual(OTHER_BLOCKS)
    })

    await test.step('the other test is untouched in storage', async () => {
      const after = await stored(request, otherId)
      expect({ version: after.version, blocks: blocksOf(after), lines: linesOf(after) }).toEqual({
        version: '1.0.0',
        blocks: OTHER_BLOCKS,
        lines: linesOf(other),
      })
    })
  })

  test('a holder with unsaved edits refuses the watched change: SESSION_HELD, nothing streamed or written, the edits stay', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const { testId, name } = await seedChangeTest(request)

    let reportedDirty = (): boolean => false
    const tab = await openHolder(browser, testId, track, (opened) => {
      reportedDirty = trackDirtyReport(opened)
    })
    await expect.poll(async () => (await nodeIds(tab)).sort()).toEqual(STORED_IDS)
    const holding = await waitUntilHeld(request)
    expect(holding.kind).toBe('person')

    await dragPaletteItemToCanvas(tab, 'shell script', { x: 400, y: 300 })
    await expect(tab.locator(SAVE_BUTTON)).toBeEnabled()
    await expect.poll(() => reportedDirty(), { message: 'the tab tells the server it has unsaved work' }).toBe(true)
    await recordView(tab)
    await expect.poll(async () => (await viewSamples(tab)).length).toBeGreaterThan(0)

    const result = await startChange(testId, name)
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload).toEqual({ amended: false, findings: [SESSION_HELD] })

    await test.step('the tab keeps its edits and the session', async () => {
      expect((await ownershipState(request)).holder?.id).toBe(holding.id)
      await expect(tab.locator(SEL.banner)).toHaveCount(0)
      await expect(tab.locator(SAVE_BUTTON)).toBeEnabled()
      expect(await nodeIds(tab)).toHaveLength(STORED_IDS.length + 1)
      const samples = await viewSamples(tab)
      expect(
        samples.filter((sample) => sample.watchingMcp),
        `nothing streamed into the tab: ${JSON.stringify(samples)}`,
      ).toEqual([])
    })

    await test.step('nothing is written', async () => {
      const after = await stored(request, testId)
      expect({ version: after.version, blocks: blocksOf(after) }).toEqual({
        version: '1.0.0',
        blocks: STORED_BLOCKS,
      })
    })
  })
})
