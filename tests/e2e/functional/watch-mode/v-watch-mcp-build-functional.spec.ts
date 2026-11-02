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
 * REQ-5.2.7.17 / WATCH-1/2/3/5/6.
 *
 * Pass Criteria:
 *  1. A person mirroring the MCP build sees blocks appear one-by-one, the active
 *     block carrying the change pulse + steady violet border; on completion the
 *     test is SAVED (v1.0.0, full workflow) and validates with zero errors.
 *  2. A tab taking over mid-build inherits the dirty draft with no lingering
 *     violet border, and the build saves nothing (`released: "taken_over"`).
 */

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT } from '../../helpers/config'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import {
  SEL,
  resetOwnership,
  waitUntilHeld,
  ownershipState,
  nodeIds,
} from '../../helpers/ownership'
import { stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'

// One MCP port per stack so host-mode parallel workers never collide.
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
  const name = `${BASE_NAME} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const recipe = fs.readFileSync(RECIPE_PATH, 'utf-8').replace(BASE_NAME, name)
  return { recipe, name }
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
})
