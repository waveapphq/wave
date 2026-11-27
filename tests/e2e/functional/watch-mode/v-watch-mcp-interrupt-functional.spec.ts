/**
 * V-WATCH-MCP-INTERRUPT-FUNCTIONAL: what happens when something meets an assistant's watched change
 * of a saved test while it still plays over the real MCP endpoint.
 * Design Decisions: WATCH-5, WATCH-9, RUNM-2, SESS-5..8
 * REQ: REQ-5.2.7.16, REQ-5.2.7.18
 *
 * The stored test is Alpha, Bravo (with its own recipe key) and a Delay. Each change keeps Alpha,
 * adds a run of Logs after it, renames Bravo and removes the Delay, so it plays long enough to act
 * on. Every step that must happen while the change plays starts the call without waiting for it,
 * waits for a given frame in the tab, then acts; each test proves the change was still playing.
 *
 * Pass Criteria:
 *  1. A tab that had another test open, with a redo step of its own and nothing unsaved, watches
 *     the change: its Undo and Redo are disabled, and Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y change
 *     nothing (from step one on it never shows the other test's Blocks or the removed Delay).
 *     It then takes the change over mid-way: the change answers taken over and saves nothing; the
 *     tab is told it now holds the session and holds the half-done change as unsaved work; an
 *     edit plus undo returns to the change as taken over, still unsaved, with nothing left to undo.
 *  2. A rename of the test while the change plays: the change answers that the test was saved
 *     elsewhere and saves nothing; the stored test keeps the rename and its old Blocks; the tab
 *     that gave way holds the session again with the streamed change as unsaved work.
 *  3. A tab that opens the test being changed from the Tests page while the change plays browses
 *     on its own; when the change is saved, the session comes back to it showing the saved change
 *     from storage, clean, not the version or the half-done frame it had.
 *  4. The assistant drops mid-change (its call is canceled and its session ends): the slot frees
 *     with nobody named, and nothing is saved. The tab that gave way takes the free slot, is told
 *     it now holds the session, and holds the half-done change as unsaved work, which it reports
 *     to the server.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/watch-mode/v-watch-mcp-interrupt-functional.spec.ts
 */

import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL } from '../../helpers/config'
import { cleanUp, storedTest } from '../../helpers/fn-block'
import {
  callToolAsync,
  enableMcpUntilRestart,
  resetMcpSettings,
  startCancelableCall,
  type CancelableToolCall,
  type McpToolResult,
} from '../../helpers/mcp'
import { SEL, nodeIds, ownershipState, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import { clickUndo, dragNodeBy, readNodeTransform, redoBtn, undoBtn } from '../../helpers/workbench'
import {
  importFixture,
  loadFixture,
  openHolder,
  recordView,
  shownBlocks,
  trackDirtyReport,
  uniqueName,
  viewSamples,
  waitForAssistantFrame,
} from './helpers'

// The MCP listener port sits 765 above the shard backend port.
const MCP_PORT = Number(BACKEND_PORT) + 765
const WATCHED_CHANGE = 'amend_test_live_from_recipe'
const SAVE_BUTTON = '[data-testid="toolbar-save-button"]'
const BREADCRUMB = '[data-testid="breadcrumb-path"]'
const STORED_IDS = ['node-1', 'node-2', 'node-3']
const STORED_BLOCKS = ['node-1=Alpha', 'node-2=Bravo', 'node-3=Pause']
const OTHER_BLOCKS = ['fn-1=Function_1', 'top-a=Log']
/** Logs the change adds: each is a turn of 0.4 s, which leaves seconds to act after the frame waited for. */
const INSERTED = 12
/** Enough turns to go to the Tests page, find the test and open it while the change plays. */
const INSERTED_FOR_BROWSING = 30
/** A Block the change adds, by its name. */
const INSERTED_NAME = /=Step \d+$/
const STEP_ONE = { present: ['node-1'], absent: ['node-3'] }
const SAVED_MEANWHILE = {
  step: 'test',
  code: 'STALE_RECIPE_VERSION',
  severity: 'error',
  problem: 'The test was saved elsewhere while the change played',
  fix: 'Read the test back again and re-apply your changes',
}

interface StoredWorkflowTest {
  name: string
  version: string
  workflow: { nodes: { id: string; data: { label: string } }[] }
}

const open: BrowserContext[] = []
const track = (context: BrowserContext): void => {
  open.push(context)
}
const created: string[] = []
const calls: CancelableToolCall[] = []

async function stored(request: APIRequestContext, testId: string): Promise<{ name: string; version: string; blocks: string[] }> {
  const saved = (await storedTest(request, testId)) as unknown as StoredWorkflowTest
  return {
    name: saved.name,
    version: saved.version,
    blocks: saved.workflow.nodes.map((node) => `${node.id}=${node.data.label}`).sort(),
  }
}

/** Keep Alpha, add `inserted` Logs after it, rename Bravo (its key keeps it the same Block) and drop the Delay. */
function longChangeRecipe(name: string, inserted: number): string {
  const added = Array.from(
    { length: inserted },
    (_, index) => `  - block: log\n    label: Step ${index + 1}\n    settings: {message: step-${index + 1}}`,
  )
  return [
    'test:',
    `  name: ${JSON.stringify(name)}`,
    '  description: Watched change met mid-way',
    'flow:',
    '  - block: log',
    '    label: Alpha',
    '    settings: {message: alpha}',
    ...added,
    '  - block: log',
    '    label: Bravo Revised',
    '    key: bravo',
    '    settings: {message: bravo-revised}',
    '',
  ].join('\n')
}

/** Import the test the change rewrites; returns its id and name. */
async function seedChangeTest(request: APIRequestContext): Promise<{ testId: string; name: string }> {
  const testId = await importFixture(request, loadFixture('fixture-change.json'))
  created.push(testId)
  const seeded = await stored(request, testId)
  expect(seeded.blocks).toEqual(STORED_BLOCKS)
  return { testId, name: seeded.name }
}

/** The half-done change a tab holds: Alpha, at least the first added Log, and no Delay or other test. */
function expectHalfDone(blocks: string[]): void {
  expect(blocks, 'the change keeps Alpha').toContain('node-1=Alpha')
  expect(blocks.filter((block) => INSERTED_NAME.test(block)).length, 'the first added Log has landed').toBeGreaterThan(0)
  expect(
    blocks.filter((block) => block === 'node-3=Pause' || OTHER_BLOCKS.includes(block)),
    'no removed Delay and no Block of another test',
  ).toEqual([])
}

function startChange(testId: string, name: string, inserted: number): Promise<McpToolResult> {
  return callToolAsync(MCP_PORT, WATCHED_CHANGE, { test_ref: testId, recipe: longChangeRecipe(name, inserted) })
}

test.describe('V-WATCH-MCP-INTERRUPT-FUNCTIONAL: a watched change met while it plays', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const call of calls.splice(0)) {
      call.cancel()
      await call.result.catch(() => null)
    }
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
    await cleanUp(request, created)
    await resetMcpSettings(page)
  })

  test('a watching tab cannot undo or redo, and after it takes over, undo never brings back the test it showed before', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const otherId = await importFixture(request, loadFixture('fixture-follow.json'))
    created.push(otherId)
    const { testId, name } = await seedChangeTest(request)

    let reportedDirty = (): boolean => false
    const tab = await openHolder(browser, otherId, track, (opened) => {
      reportedDirty = trackDirtyReport(opened)
    })
    await expect.poll(async () => (await nodeIds(tab)).sort()).toEqual(['fn-1', 'top-a'])
    const gaveWay = await waitUntilHeld(request)
    expect(gaveWay.kind).toBe('person')

    await test.step('the tab has a redo step of its own on the other test, and nothing unsaved', async () => {
      const moved = await dragNodeBy(tab, 'top-a')
      await expect.poll(() => reportedDirty(), { message: 'the move is unsaved work' }).toBe(true)
      await clickUndo(tab)
      await expect.poll(() => readNodeTransform(tab, 'top-a')).toBe(moved.before)
      await expect(tab.locator(SAVE_BUTTON)).toBeDisabled()
      await expect(redoBtn(tab)).toBeEnabled()
      await expect.poll(() => reportedDirty(), { message: 'the undo leaves nothing unsaved' }).toBe(false)
    })
    await recordView(tab)
    await expect.poll(async () => (await viewSamples(tab)).length).toBeGreaterThan(0)

    const change = startChange(testId, name, INSERTED)

    await test.step('while it watches the change, undo, redo and their shortcuts do nothing', async () => {
      await waitForAssistantFrame(tab, STEP_ONE)
      await expect(undoBtn(tab)).toBeDisabled()
      await expect(redoBtn(tab)).toBeDisabled()
      for (const keys of ['Control+Shift+Z', 'Control+y', 'Control+z']) await tab.keyboard.press(keys)
      await expect(tab.locator(SEL.bannerMcp), 'the tab still watches the change').toBeVisible()
    })

    await test.step('it takes the change over mid-way, and nothing is saved', async () => {
      await waitForAssistantFrame(tab, { ...STEP_ONE, turn: true })
      await tab.locator(SEL.bannerMcp).locator(SEL.takeOver).click()
      const result = await change
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload, 'the change stops for the take-over').toEqual({ amended: false, released: 'taken_over' })
      expect(await stored(request, testId)).toMatchObject({ version: '1.0.0', blocks: STORED_BLOCKS })
    })

    const told = tab.getByRole('alertdialog', { name: 'You now hold the session' })
    await expect(told).toBeVisible({ timeout: 15_000 })
    await told.getByRole('button').click()
    await expect(told).toHaveCount(0)
    expect((await ownershipState(request)).holder?.id).toBe(gaveWay.id)
    await expect(tab.locator(SEL.banner)).toHaveCount(0)
    await expect(tab.locator(SAVE_BUTTON), 'the half-done change is unsaved work').toBeEnabled()
    const taken = await shownBlocks(tab)
    expectHalfDone(taken)
    const takenPlace = await readNodeTransform(tab, 'node-1')

    await test.step('an edit plus undo returns to the change as taken over, still unsaved', async () => {
      await dragNodeBy(tab, 'node-1')
      await clickUndo(tab)
      await expect.poll(() => readNodeTransform(tab, 'node-1')).toBe(takenPlace)
      expect(await shownBlocks(tab), 'undo never brings back the test shown before').toEqual(taken)
      await expect(tab.locator(SAVE_BUTTON), 'the change taken over is still unsaved').toBeEnabled()
      await expect(undoBtn(tab), 'undo stops at the change taken over').toBeDisabled()
    })

    await test.step('from step one on, the tab never showed the other test or the removed Delay', async () => {
      const samples = await viewSamples(tab)
      const detail = JSON.stringify(samples)
      expect(samples[0].blocks, 'the tab showed the other test before the change').toEqual(OTHER_BLOCKS)
      const stepOne = samples.findIndex((sample) => sample.watchingMcp && sample.blocks.includes('node-1=Alpha'))
      expect(stepOne, `the tab showed step one: ${detail}`).toBeGreaterThan(0)
      expect(
        samples
          .slice(stepOne)
          .filter((sample) => sample.blocks.some((block) => block === 'node-3=Pause' || OTHER_BLOCKS.includes(block))),
        `no undo or redo put another canvas over the change: ${detail}`,
      ).toEqual([])
    })
  })

  test('a rename while the change plays: the change answers that the test was saved elsewhere and saves nothing', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const { testId, name } = await seedChangeTest(request)
    const tab = await openHolder(browser, testId, track)
    await expect.poll(async () => (await nodeIds(tab)).sort()).toEqual(STORED_IDS)
    const gaveWay = await waitUntilHeld(request)
    expect(gaveWay.kind).toBe('person')

    const change = startChange(testId, name, INSERTED)
    const renamed = uniqueName('Watch Renamed Meanwhile')
    await test.step('the test is renamed once step one shows', async () => {
      await waitForAssistantFrame(tab, STEP_ONE)
      const resp = await request.patch(`${BACKEND_URL}/tests/${testId}/metadata`, { data: { name: renamed } })
      expect(resp.ok(), `PATCH /tests/${testId}/metadata failed: ${resp.status()} - ${await resp.text()}`).toBeTruthy()
    })

    const result = await change
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload, 'the change was out of date when it came to save').toEqual({
      amended: false,
      findings: [SAVED_MEANWHILE],
    })
    expect(await stored(request, testId), 'the rename stays and the change saved nothing').toEqual({
      name: renamed,
      version: '1.0.0',
      blocks: STORED_BLOCKS,
    })

    await test.step('the tab that gave way holds the streamed change as unsaved work', async () => {
      await expect
        .poll(async () => (await ownershipState(request)).holder?.id, { timeout: 15_000 })
        .toBe(gaveWay.id)
      await expect(tab.locator(SEL.banner)).toHaveCount(0)
      await expect(tab.locator(SAVE_BUTTON)).toBeEnabled()
      await expect(tab.getByRole('alertdialog')).toHaveCount(0)
    })
  })

  test('a tab that opened the test being changed on its own gets the session back showing the saved change', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const { testId, name } = await seedChangeTest(request)
    const tab = await openHolder(browser, testId, track)
    await expect.poll(async () => (await nodeIds(tab)).sort()).toEqual(STORED_IDS)
    const gaveWay = await waitUntilHeld(request)
    expect(gaveWay.kind).toBe('person')

    const change = startChange(testId, name, INSERTED_FOR_BROWSING)
    await test.step('mid-change, the tab opens the test from the Tests page', async () => {
      await waitForAssistantFrame(tab, STEP_ONE)
      await tab.locator('a[href="/tests"]').first().click()
      await expect(tab.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 30_000 })
      await tab.locator('[data-testid="search-input"] input').fill(name)
      const cell = tab.locator(`[data-testid="test-row"][data-row-id="${testId}"] [data-testid="test-name"]`)
      await expect(cell).toBeVisible({ timeout: 15_000 })
      await cell.click()
      await expect(tab.locator(SEL.canvas)).toBeVisible({ timeout: 30_000 })
      await expect(
        tab.locator(SEL.bannerMcp).locator(SEL.watchSession),
        'the tab browses on its own while the change still plays',
      ).toBeVisible()
    })

    const result = await change
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload, JSON.stringify(result.payload)).toMatchObject({ amended: true, test_id: testId, name })
    const saved = await stored(request, testId)
    expect(saved.version).toBe(result.payload.version)
    expect(saved.blocks.filter((block) => INSERTED_NAME.test(block))).toHaveLength(INSERTED_FOR_BROWSING)
    expect(saved.blocks).toContain('node-2=Bravo Revised')

    await test.step('the session comes back to it on the saved change, clean', async () => {
      await expect
        .poll(async () => (await ownershipState(request)).holder?.id, { timeout: 15_000 })
        .toBe(gaveWay.id)
      await expect(tab.locator(SEL.banner)).toHaveCount(0)
      await expect.poll(() => shownBlocks(tab), { timeout: 15_000 }).toEqual(saved.blocks)
      await expect(tab.locator(SAVE_BUTTON)).toBeDisabled()
      await expect(tab.locator(BREADCRUMB)).toContainText(name)
      await expect(tab.getByRole('alertdialog')).toHaveCount(0)
    })
  })

  test('the assistant drops mid-change: the tab that takes the free slot holds the half-done change as unsaved and is told', async ({
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
    const gaveWay = await waitUntilHeld(request)
    expect(gaveWay.kind).toBe('person')

    const call = startCancelableCall(MCP_PORT, WATCHED_CHANGE, {
      test_ref: testId,
      recipe: longChangeRecipe(name, INSERTED),
    })
    calls.push(call)

    await test.step('the assistant drops after the first added Log lands', async () => {
      await waitForAssistantFrame(tab, { ...STEP_ONE, turn: true })
      call.cancel()
      expect(await call.result, 'the call ended before the change answered').toBeNull()
      await expect
        .poll(async () => (await ownershipState(request)).holder, {
          timeout: 15_000,
          message: 'the slot frees with nobody named',
        })
        .toBeNull()
      expect(await stored(request, testId), 'nothing is saved').toMatchObject({ version: '1.0.0', blocks: STORED_BLOCKS })
    })

    await test.step('the tab that gave way takes the free slot and is told it now holds the session', async () => {
      const banner = tab.locator('[data-testid="mirror-banner"][data-holder-kind="none"]')
      await expect(banner).toBeVisible({ timeout: 15_000 })
      await banner.locator(SEL.takeOver).click()
      const told = tab.getByRole('alertdialog', { name: 'You now hold the session' })
      await expect(told).toBeVisible({ timeout: 15_000 })
      await told.getByRole('button').click()
      await expect(told).toHaveCount(0)
      await expect
        .poll(async () => (await ownershipState(request)).holder?.id, { timeout: 15_000 })
        .toBe(gaveWay.id)
    })

    await test.step('it holds the half-done change as unsaved work', async () => {
      await expect(tab.locator(SEL.banner)).toHaveCount(0)
      await expect(tab.locator(SEL.canvasReadOnly)).toHaveCount(0)
      await expect(tab.locator(SAVE_BUTTON)).toBeEnabled()
      await expect.poll(() => reportedDirty(), { message: 'the tab tells the server it holds unsaved work' }).toBe(true)
      expectHalfDone(await shownBlocks(tab))
    })
  })
})
