/**
 * V-WATCH-MCP-BUILD-FUNCTIONAL: the REAL wire-level MCP watch
 * build. `build_test_from_recipe` holds the workbench session and reveals a
 * test block-by-block into the mirrored draft, then saves at completion. A
 * Playwright browser mirrors `/workbench` and observes the reveal; a mid-build
 * take-over abandons the build and hands the dirty draft to the taker (WATCH-5).
 *
 * Reuses the python MCP client harness
 * (`../recipe-authoring/mcp_recipe_client.py`) over streamable-HTTP. The build
 * call blocks for the whole reveal, so it is spawned ASYNCHRONOUSLY (unlike the
 * one-shot `create_test_from_recipe` template) so the browser can watch it live.
 *
 * REQ-5.2.7.17 / WATCH-1/2/3/5/6/8.
 *
 * Pass Criteria:
 *  1. A person mirroring the MCP build sees blocks appear one-by-one, the active
 *     block carrying the change pulse + steady violet border; on completion the
 *     test is SAVED (v1.0.0, full workflow) and validates with zero errors.
 *  2. A tab taking over mid-build inherits the dirty draft with no lingering
 *     violet border, and the build saves nothing (`released: "taken_over"`).
 *  3. A build that fits the tab: in the holder that gives way and in a watching
 *     tab, both panned away first, Block 1 appears on its own under the
 *     assistant's banner, the view frames the finished test with it (every
 *     Block and the Start node in view at the end) and does not move again.
 *  4. A build too tall for the tab even at the smallest zoom: Block 1 appears on
 *     its own under the assistant's banner, and the view starts at
 *     that zoom on the top of the test (the Start node in view), never moves up
 *     or sideways, holds still while new Blocks land in view, and moves down
 *     only to bring a new Block into view - each Block is in view once it lands.
 */

import { randomUUID } from 'node:crypto'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { APIRequestContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT } from '../../helpers/config'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import {
  SEL,
  resetOwnership,
  waitUntilHeld,
  ownershipState,
  nodeIds,
  openWorkbench,
} from '../../helpers/ownership'
import { stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'
import {
  buildSamples,
  lookAway,
  offsetOf,
  viewSamples,
  viewportTransform,
  zoomOf,
  type ViewSample,
} from './helpers'

// The MCP listener port sits 765 above the shard backend port.
const MCP_PORT = Number(BACKEND_PORT) + 765
const RECIPE_PATH = path.resolve(__dirname, 'recipe-watch-build.yaml')
const CLIENT_PATH = path.resolve(__dirname, '../recipe-authoring/mcp_recipe_client.py')
const BACKEND_DIR = path.resolve(__dirname, '../../../../backend')
const BASE_NAME = 'Watch Build Linear'
const NODE_COUNT = 20

interface McpToolResult {
  isError: boolean
  payload: Record<string, unknown>
}

/** Spawn the python MCP client asynchronously; resolve with the printed envelope on exit. */
function buildAsync(recipe: string, url: string): Promise<McpToolResult> {
  const child = spawn('poetry', ['run', 'python', CLIENT_PATH, url, 'build_test_from_recipe'], {
    cwd: BACKEND_DIR,
  })
  child.stdin.write(recipe)
  child.stdin.end()
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => {
    stdout += d.toString()
  })
  child.stderr.on('data', (d) => {
    stderr += d.toString()
  })
  return new Promise<McpToolResult>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      const lastLine = stdout.trim().split('\n').pop() ?? ''
      try {
        resolve(JSON.parse(lastLine) as McpToolResult)
      } catch {
        reject(new Error(`MCP client exited ${code}: stdout=${stdout} stderr=${stderr}`))
      }
    })
  })
}

function uniqueRecipe(): { recipe: string; name: string } {
  const name = `${BASE_NAME} ${Date.now()}-${randomUUID().slice(0, 6)}`
  const recipe = fs.readFileSync(RECIPE_PATH, 'utf-8').replace(BASE_NAME, name)
  return { recipe, name }
}

/** A linear recipe of a few log Blocks: a test that fits the tab. */
function shortRecipe(count: number): string {
  const name = `Watch Build Framed ${Date.now()}-${randomUUID().slice(0, 6)}`
  const steps = Array.from(
    { length: count },
    (_, index) => `  - block: log\n    settings: {message: framed-${index + 1}}`,
  ).join('\n')
  return `test:\n  name: ${name}\n  description: Framed watch build\n  tags: [e2e, watch, mcp]\nflow:\n${steps}\n`
}

/** Hold an empty workbench as a person, look away from where the build will land, and record the view. */
async function holdAndLookAway(page: Page, request: APIRequestContext): Promise<void> {
  await stubSessionRecovery(page)
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  expect((await waitUntilHeld(request)).kind).toBe('person')
  await lookAway(page)
}

function lastOf(samples: ViewSample[], count: number): ViewSample | undefined {
  return samples.filter((sample) => sample.count === count).at(-1)
}

/** The build first shows in a tab as Block 1 on its own, under the assistant's banner. */
async function expectBlockOneFirst(page: Page): Promise<void> {
  const samples = await viewSamples(page)
  const first = samples.find((sample) => sample.count >= 1)
  expect(first, `Block 1 appears on its own under the assistant's banner: ${JSON.stringify(samples)}`).toMatchObject({
    count: 1,
    watchingMcp: true,
  })
}

test.describe('V-WATCH-MCP-BUILD-FUNCTIONAL: live MCP build - mirror the reveal + take over mid-build', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })
  test.afterEach(async ({ page, request }) => {
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('mirror an MCP live build: blocks reveal with the pulse + active border, and the build saves a valid test', async ({
    page,
    request,
  }) => {
    const url = await enableMcpUntilRestart(page, MCP_PORT)
    expect(url).toBe(`http://127.0.0.1:${MCP_PORT}/mcp`)
    const { recipe, name } = uniqueRecipe()

    // Kick off the live build asynchronously so the browser can watch it stream.
    const build = buildAsync(recipe, url)

    // The MCP session claims the editing slot.
    const holder = await waitUntilHeld(request)
    expect(holder.kind).toBe('mcp')

    // Open a browser that mirrors the build.
    await stubSessionRecovery(page)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expect(page.locator(SEL.bannerMcp)).toBeVisible()

    // Blocks appear one-by-one; the active block carries the pulse + violet border.
    await expect(page.locator('[data-testid^="node-change-pulse-"]')).toBeVisible({ timeout: 12_000 })
    await expect(page.locator('[data-mirror-active="true"]')).toBeVisible()
    // Node count climbs to the full workflow.
    await expect
      .poll(async () => (await nodeIds(page)).length, { timeout: 25_000 })
      .toBeGreaterThanOrEqual(NODE_COUNT)

    // The build completes and returns the created test.
    const result = await build
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload.built, JSON.stringify(result.payload)).toBe(true)
    const testId = result.payload.test_id as string
    expect(testId).toBeTruthy()
    expect(result.payload.version).toBe('1.0.0')
    expect(result.payload.name).toBe(name)

    // The MCP session released the slot after the build (the watching tab may
    // then re-claim the freed slot as a person holder - that is expected).
    await expect
      .poll(async () => (await ownershipState(request)).holder?.kind, { timeout: 10_000 })
      .not.toBe('mcp')

    // The saved test is valid: full workflow persisted + zero validation errors.
    const saved = await request.get(`${BACKEND_URL}/tests/${testId}`)
    const savedBody = await saved.json()
    expect(savedBody.data.workflow.nodes).toHaveLength(NODE_COUNT)
    const validate = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
    const validateBody = await validate.json().catch(() => null)
    expect(validate.ok(), JSON.stringify(validateBody)).toBeTruthy()
    const errors =
      validateBody?.data?.errors ??
      validateBody?.error?.details?.[0]?.errors ??
      validateBody?.errors ??
      []
    expect(errors.length, JSON.stringify(errors)).toBe(0)
  })

  test('take over an MCP build mid-reveal: the taker inherits a dirty draft with no lingering border, and nothing is saved', async ({
    page,
    request,
  }) => {
    const url = await enableMcpUntilRestart(page, MCP_PORT)
    const { recipe, name } = uniqueRecipe()

    const build = buildAsync(recipe, url)
    const holder = await waitUntilHeld(request)
    expect(holder.kind).toBe('mcp')

    // Hold this tab's ownership reads: the build's frames paint the canvas
    // before the tab settles into watching, so the take-over is decided on the
    // blocks the tab adopted and not on a frame that lands after it starts.
    let releaseOwnershipRead = (): void => {}
    const ownershipRead = new Promise<void>((resolve) => {
      releaseOwnershipRead = resolve
    })
    await page.route(
      (target) => target.pathname.endsWith('/workbench/ownership'),
      async (route) => {
        if (route.request().method() === 'GET') await ownershipRead
        await route.continue()
      },
    )

    await stubSessionRecovery(page)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Blocks stream onto the canvas while the ownership read is still held.
    await expect
      .poll(async () => (await nodeIds(page)).length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3)
    const adopted = (await nodeIds(page)).length
    // Release on the heels of a reveal step, so a whole step is left to press
    // Take over before the next block can arrive.
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]').length > count,
      adopted,
      { timeout: 15_000 },
    )
    releaseOwnershipRead()

    // The banner names the MCP build; its Take Over is pressed straight away.
    await page.locator(SEL.bannerMcp).locator(SEL.takeOver).click()

    // The build aborts on the pending take-over and hands the slot to this tab.
    const grant = page.getByRole('alertdialog', { name: 'You now hold the session' })
    await expect(grant).toBeVisible({ timeout: 15_000 })
    await grant.getByRole('button', { name: 'Start editing' }).click()

    // The taker now edits the inherited draft: no banner, no border.
    await expect(page.locator(SEL.banner)).toHaveCount(0)
    await expect(page.locator('[data-mirror-active="true"]')).toHaveCount(0)

    // The build returns "taken over" and saved nothing.
    const result = await build
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload.built).toBe(false)
    expect(result.payload.released).toBe('taken_over')

    // The build has stopped, so the canvas can grow no further: the draft is
    // unsaved work on the strength of the adopted blocks alone.
    await expect(page.locator('[data-testid="toolbar-save-button"]')).toBeEnabled()

    // Nothing was persisted under the recipe name.
    const list = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`)
    const listBody = await list.json()
    expect(listBody.data ?? []).toHaveLength(0)
  })

  test('a build that fits frames the finished test at its first Block in every watching tab, then holds still', async ({
    browser,
    page,
    request,
  }) => {
    const url = await enableMcpUntilRestart(page, MCP_PORT)
    await holdAndLookAway(page, request)
    const watcher = await openWorkbench(browser)
    try {
      await expect(watcher.page.locator(SEL.bannerPerson)).toBeVisible()
      await lookAway(watcher.page)
      const tabs = [
        { tab: page, before: await viewportTransform(page) },
        { tab: watcher.page, before: await viewportTransform(watcher.page) },
      ]

      const result = await buildAsync(shortRecipe(4), url)
      expect(result.payload.built, JSON.stringify(result.payload)).toBe(true)

      for (const { tab, before } of tabs) {
        await expectBlockOneFirst(tab)
        const samples = await buildSamples(tab)
        const detail = JSON.stringify(samples)
        const finished = samples.at(-1)
        expect(finished?.count, `the tab watched the whole build: ${detail}`).toBe(4)
        const framed = finished!.transform
        expect(framed, 'the view moved to frame the build').not.toBe(before)
        // The frame lands while only Block 1 is on the canvas, and nothing moves after it.
        expect(lastOf(samples, 1)?.transform, detail).toBe(framed)
        for (const sample of samples) expect([before, framed], detail).toContain(sample.transform)
        for (const sample of samples.filter((s) => s.count >= 2)) {
          expect(sample.transform, detail).toBe(framed)
        }
        // That view holds the finished test: every Block and the Start node.
        expect(finished!.allInView && finished!.startInView, detail).toBe(true)
      }
    } finally {
      await watcher.context.close()
    }
  })

  test('a build too tall for the tab starts on its top at the smallest zoom and moves down only to show a new Block', async ({
    page,
    request,
  }) => {
    const url = await enableMcpUntilRestart(page, MCP_PORT)
    await holdAndLookAway(page, request)

    const result = await buildAsync(uniqueRecipe().recipe, url)
    expect(result.payload.built, JSON.stringify(result.payload)).toBe(true)

    await expectBlockOneFirst(page)
    const samples = await buildSamples(page)
    const detail = JSON.stringify(samples)
    expect(samples.at(-1)?.count, `the tab watched the whole build: ${detail}`).toBe(NODE_COUNT)
    const first = lastOf(samples, 1)!
    // The canvas's smallest zoom, on the top of the test where the build begins.
    expect(zoomOf(first.transform), detail).toBe(0.5)
    expect(first.startInView && first.newestInView, detail).toBe(true)
    // Each Block is in view once it lands.
    for (let count = 1; count <= NODE_COUNT; count++) {
      expect(lastOf(samples, count)?.newestInView, `Block ${count} lands in view: ${detail}`).toBe(true)
    }
    // A Block that lands in view does not move it: no jump to every Block.
    expect(lastOf(samples, 3)?.transform, detail).toBe(first.transform)
    // From the frame on, the view keeps its zoom, never moves sideways or up, and moves at most once per Block.
    const settled = samples.slice(samples.indexOf(first))
    for (const sample of settled) expect(zoomOf(sample.transform), detail).toBe(0.5)
    expect(new Set(settled.map((sample) => offsetOf(sample.transform).x)).size, detail).toBe(1)
    for (let index = 1; index < settled.length; index++) {
      expect(offsetOf(settled[index].transform).y, detail).toBeLessThanOrEqual(
        offsetOf(settled[index - 1].transform).y,
      )
    }
    for (let count = 2; count <= NODE_COUNT; count++) {
      const views = new Set(settled.filter((s) => s.count === count).map((s) => s.transform))
      expect(views.size, `the view moves at most once for Block ${count}`).toBeLessThanOrEqual(2)
    }
    expect(new Set(settled.map((sample) => sample.transform)).size).toBeLessThan(NODE_COUNT)
  })
})
