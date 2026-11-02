/**
 * V-RUNM-MCP-FUNCTIONAL: assistant-held runs borrow the session and mirror.
 * Design Decisions: RUNM-5, RUNM-6, RUNM-7, RUNM-8; MCP-1..9
 * REQ: REQ-5.2.7.15, REQ-5.2.7.16
 *
 * Pass Criteria:
 * 1. An assistant test run over a clean idle holder auto-yields the tab with
 *    NO dialog; the banner names "<client> (MCP)" and reads "running live";
 *    the console streams; the tool reply carries mirrored: true.
 * 2. On terminal the slot hands back silently (no "You now hold the session"
 *    dialog); the tab inherits CLEAN (Save disabled) with run paint kept.
 * 3. The execution record is attributed "mcp:<client>" (Executions row).
 * 4. A dirty holder refuses the borrow: the run still starts, mirrored: false,
 *    the tab keeps the session; once clean again the next claim yields.
 * 5. Suite runs never borrow the workbench (mirrored: false, slot untouched).
 * 6. A second start while a run is in flight fails synchronously in the tool
 *    reply with the active-session conflict message.
 * 7. Take Over during an assistant run grants immediately and silently (the
 *    mirror just ends, no dialog); the run continues.
 * 8. An MCP amend of the open test converges the tab on the amended version,
 *    clean - a save right after cannot resurrect the pre-amend workflow.
 * 9. A watch build over an open test shows an unsaved draft breadcrumb during
 *    the reveal and hands back bound to the NEW test, clean, with the
 *    previously open test intact in storage.
 */

import { spawn } from 'child_process'
import path from 'path'
import type { BrowserContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, E2E_ENV_NAME } from '../../helpers/config'
import { callTool, enableMcpUntilRestart, type McpToolResult, resetMcpSettings } from '../../helpers/mcp'
import { SEL, resetOwnership, waitUntilHeld, ownershipState } from '../../helpers/ownership'
import { dragPaletteItemToCanvas } from '../../helpers/canvas'
import {
  loadFixture,
  importFixture,
  openHolderWithTest,
  allowRunAttach,
  ensureConsoleExpanded,
  consoleRows,
  pollExecutionTerminal,
} from './helpers'

const MCP_PORT = Number(BACKEND_PORT) + 765
const CLIENT_PATH = path.resolve(__dirname, '../recipe-authoring/mcp_tool_client.py')
const BACKEND_DIR = path.resolve(__dirname, '../../../../backend')
const CLIENT_NAME = 'wave-e2e-tool-client'

/** Spawn the client asynchronously for tools that block (watch build). */
function callToolAsync(tool: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const child = spawn(
    'poetry',
    ['run', 'python', CLIENT_PATH, `http://127.0.0.1:${MCP_PORT}/mcp`, tool],
    { cwd: BACKEND_DIR },
  )
  child.stdin.write(JSON.stringify(args))
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

function uniqueName(base: string): string {
  return `${base} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function logRecipe(name: string, messages: string[]): string {
  const steps = messages
    .map((message) => `  - block: log\n    settings: {message: ${message}}`)
    .join('\n')
  return `test:\n  name: ${name}\n  description: Run mirror MCP e2e\n  tags: [e2e, run-mirror]\nflow:\n${steps}\n`
}

async function expectNoDialog(page: Page): Promise<void> {
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
}

const open: BrowserContext[] = []

test.describe('V-RUNM-MCP-FUNCTIONAL: assistant-held runs, auto-yield and hand-back', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('auto-yield borrow: mirrored run, silent hand-back, clean inherit, mcp attribution', async ({
    browser,
    page,
    request,
  }) => {
    const testId = await importFixture(request, loadFixture())
    const tab = await openHolderWithTest(browser, testId, (c) => open.push(c))
    const holder = await waitUntilHeld(request)
    expect(holder.kind).toBe('person')
    await ensureConsoleExpanded(tab)
    await allowRunAttach(tab)

    await enableMcpUntilRestart(page, MCP_PORT)
    const result = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: testId,
      environment: E2E_ENV_NAME,
    })
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload.mirrored, 'a clean idle holder yields to the borrow').toBe(true)
    const executionId = result.payload.execution_id as string
    expect(executionId).toBeTruthy()

    await test.step('the tab flips to watching with no dialog', async () => {
      await expect(tab.locator(SEL.bannerMcp)).toBeVisible({ timeout: 15_000 })
      await expect(tab.locator(SEL.banner)).toContainText(`${CLIENT_NAME} (MCP)`)
      await expect(tab.locator(SEL.banner)).toContainText('read-only, running live')
      await expectNoDialog(tab)
      expect((await ownershipState(request)).holder?.kind).toBe('mcp')
      const readout = tab.locator(SEL.envSelector)
      await expect(readout).toContainText('Env:')
      await expect(readout).toContainText(E2E_ENV_NAME)
    })

    await test.step('the console streams while the run is in flight', async () => {
      const before = await consoleRows(tab).count()
      await expect
        .poll(async () => consoleRows(tab).count(), { timeout: 20_000 })
        .toBeGreaterThan(before)
    })

    const status = await pollExecutionTerminal(request, executionId)
    expect(status).toBe('passed')

    await test.step('silent hand-back: clean inherit with paint kept', async () => {
      await expect(tab.locator(SEL.banner)).toHaveCount(0, { timeout: 15_000 })
      await expect
        .poll(async () => (await ownershipState(request)).holder?.kind, { timeout: 15_000 })
        .toBe('person')
      await expectNoDialog(tab)
      await expect(tab.locator('[data-testid="toolbar-save-button"]')).toBeDisabled()
      await expect(
        tab.locator('[data-testid^="workflow-node-"][data-execution-status="success"]').first(),
      ).toBeVisible()
      // Settle: the dialog must not appear late either.
      await tab.waitForTimeout(1_500)
      await expectNoDialog(tab)
    })

    await test.step('the record is attributed to the MCP client', async () => {
      const detail = await request.get(`${BACKEND_URL}/executions/${executionId}`)
      const data = ((await detail.json()).data ?? {}) as { triggered_by?: string }
      expect(data.triggered_by).toBe(`mcp:${CLIENT_NAME}`)

      await tab.goto('/executions')
      const row = tab.locator('[data-testid="execution-row"]', { hasText: 'Run Mirror Slow Stream' }).first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(row.locator('[data-testid="execution-triggered-by"]')).toHaveText(
        new RegExp(`^mcp:`),
      )
    })
  })

  test('dirty holder refuses the borrow; a clean holder yields again', async ({
    browser,
    page,
    request,
  }) => {
    const firstId = await importFixture(request, loadFixture())
    const secondId = await importFixture(request, loadFixture())

    const dirtyTab = await openHolderWithTest(browser, firstId, (c) => open.push(c))
    await waitUntilHeld(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    await test.step('unsaved work refuses the borrow but the run still starts', async () => {
      await dragPaletteItemToCanvas(dirtyTab, 'shell script', { x: 400, y: 300 })
      await expect(dirtyTab.locator('[data-testid="toolbar-save-button"]')).toBeEnabled()
      await dirtyTab.waitForTimeout(1_000)

      const refused = callTool(MCP_PORT, 'start_execution', {
        entity_type: 'test',
        ref: firstId,
        environment: E2E_ENV_NAME,
      })
      expect(refused.isError, JSON.stringify(refused.payload)).toBe(false)
      expect(refused.payload.mirrored, 'a dirty holder never yields').toBe(false)
      const refusedExec = refused.payload.execution_id as string

      await expect(dirtyTab.locator(SEL.banner)).toHaveCount(0)
      expect((await ownershipState(request)).holder?.kind).toBe('person')
      expect(await pollExecutionTerminal(request, refusedExec)).toBe('passed')
      await expect(dirtyTab.locator(SEL.banner)).toHaveCount(0)
    })

    await test.step('a clean holder yields to the next borrow', async () => {
      // A fresh ?editTest tab loads through markSaved(), the deterministic
      // clean zero point (undo after an auto-connected drop does not reach it).
      for (const context of open.splice(0)) await context.close().catch(() => {})
      await resetOwnership(request)
      const cleanTab = await openHolderWithTest(browser, secondId, (c) => open.push(c))
      await waitUntilHeld(request)
      await expect(cleanTab.locator('[data-testid="toolbar-save-button"]')).toBeDisabled()
      await cleanTab.waitForTimeout(1_000)

      const granted = callTool(MCP_PORT, 'start_execution', {
        entity_type: 'test',
        ref: secondId,
        environment: E2E_ENV_NAME,
      })
      expect(granted.isError, JSON.stringify(granted.payload)).toBe(false)
      expect(granted.payload.mirrored).toBe(true)
      await expect(cleanTab.locator(SEL.bannerMcp)).toBeVisible({ timeout: 15_000 })
      await expectNoDialog(cleanTab)
      expect(await pollExecutionTerminal(request, granted.payload.execution_id as string)).toBe(
        'passed',
      )
      await expect(cleanTab.locator(SEL.banner)).toHaveCount(0, { timeout: 15_000 })
    })
  })

  test('suite runs never borrow the workbench', async ({ page, request }) => {
    const testId = await importFixture(request, loadFixture())
    const suiteResp = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: uniqueName('Run Mirror Suite'), tests: [testId] },
    })
    expect(suiteResp.ok(), `POST /suites failed: ${suiteResp.status()}`).toBeTruthy()
    const suiteId = ((await suiteResp.json()).data as { id: string }).id

    await enableMcpUntilRestart(page, MCP_PORT)
    const result = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'suite',
      ref: suiteId,
      environment: E2E_ENV_NAME,
    })
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload.mirrored, 'suites never claim the workbench').toBe(false)
    const executionId = result.payload.execution_id as string

    expect((await ownershipState(request)).holder, 'slot stays free mid-run').toBeNull()
    expect(await pollExecutionTerminal(request, executionId)).toBe('passed')
    expect((await ownershipState(request)).holder, 'slot stays free after the run').toBeNull()
  })

  test('a second start while a run is in flight fails in the tool reply', async ({
    page,
    request,
  }) => {
    const firstId = await importFixture(request, loadFixture())
    const secondId = await importFixture(request, loadFixture())

    await enableMcpUntilRestart(page, MCP_PORT)
    const first = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: firstId,
      environment: E2E_ENV_NAME,
    })
    expect(first.isError, JSON.stringify(first.payload)).toBe(false)
    const firstExec = first.payload.execution_id as string

    const second = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: secondId,
      environment: E2E_ENV_NAME,
    })
    expect(second.isError, 'the conflict surfaces in the tool reply').toBe(true)
    expect(JSON.stringify(second.payload)).toMatch(
      /User already has an active (workbench|tracked execution) session: .+\. Stop the current workbench or tracked execution before starting a new one\./,
    )

    expect(await pollExecutionTerminal(request, firstExec)).toBe('passed')
  })

  test('Take Over during an assistant run grants immediately and the run continues', async ({
    browser,
    page,
    request,
  }) => {
    const testId = await importFixture(request, loadFixture())
    const tab = await openHolderWithTest(browser, testId, (c) => open.push(c))
    await waitUntilHeld(request)
    await ensureConsoleExpanded(tab)
    await allowRunAttach(tab)

    await enableMcpUntilRestart(page, MCP_PORT)
    const result = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: testId,
      environment: E2E_ENV_NAME,
    })
    expect(result.payload.mirrored, JSON.stringify(result.payload)).toBe(true)
    const executionId = result.payload.execution_id as string
    await expect(tab.locator(SEL.bannerMcp)).toBeVisible({ timeout: 15_000 })

    // An assistant run-holder has no atomic step to finish: the grant is
    // immediate and silent - the mirror simply ends. No approval round-trip
    // and no result dialog (those belong to a request that was PENDING).
    await tab.locator(SEL.takeOver).click()
    await expect(tab.locator(SEL.banner)).toHaveCount(0, { timeout: 10_000 })
    await expect(tab.locator(SEL.canvasReadOnly)).toHaveCount(0)
    await expectNoDialog(tab)
    expect((await ownershipState(request)).holder?.kind).toBe('person')

    // The tracked run continues unaffected and its record is unharmed.
    expect(await pollExecutionTerminal(request, executionId)).toBe('passed')
  })

  test('an MCP amend of the open test converges the tab; a stale save cannot resurrect', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const name = uniqueName('Run Mirror Amend Base')
    const created = callTool(MCP_PORT, 'create_test_from_recipe', {
      recipe: logRecipe(name, ['amend-base-1', 'amend-base-2', 'amend-base-3']),
    })
    expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
    const testId = created.payload.test_id as string

    const tab = await openHolderWithTest(browser, testId, (c) => open.push(c))
    await waitUntilHeld(request)
    await expect(tab.locator('[data-testid^="workflow-node-"][data-nodetype]')).toHaveCount(3)

    const amended = callTool(MCP_PORT, 'amend_test_from_recipe', {
      test_ref: testId,
      recipe: logRecipe(name, [
        'amend-base-1',
        'amend-base-2',
        'amend-base-3',
        'amend-added-marker',
      ]),
    })
    expect(amended.payload.amended, JSON.stringify(amended.payload)).toBe(true)

    await test.step('the tab converges on the amended version, clean', async () => {
      await expect(tab.locator('[data-testid^="workflow-node-"][data-nodetype]')).toHaveCount(4, {
        timeout: 15_000,
      })
      await expect(tab.locator('[data-testid="toolbar-save-button"]')).toBeDisabled()
      await expectNoDialog(tab)
    })

    await test.step('storage keeps the amended version (no stale resurrect possible)', async () => {
      const saved = await request.get(`${BACKEND_URL}/tests/${testId}`)
      const data = ((await saved.json()).data ?? {}) as {
        version?: string
        workflow?: { nodes?: unknown[] }
      }
      expect(data.workflow?.nodes ?? []).toHaveLength(4)
      expect(data.version).toBe(amended.payload.version)
    })
  })

  test('a watch build over an open test hands back bound to the new test', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const baseName = uniqueName('Run Mirror Watch Base')
    const created = callTool(MCP_PORT, 'create_test_from_recipe', {
      recipe: logRecipe(baseName, ['watch-base-1', 'watch-base-2', 'watch-base-3']),
    })
    expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
    const baseId = created.payload.test_id as string

    const tab = await openHolderWithTest(browser, baseId, (c) => open.push(c))
    await waitUntilHeld(request)
    const breadcrumb = tab.locator('[data-testid="breadcrumb-path"]')
    await expect(breadcrumb).toContainText(baseName)

    const buildName = uniqueName('Run Mirror Watch Built')
    const build = callToolAsync('build_test_from_recipe', {
      recipe: logRecipe(buildName, [
        'watch-built-1',
        'watch-built-2',
        'watch-built-3',
        'watch-built-4',
        'watch-built-5',
        'watch-built-6',
      ]),
    })

    await test.step('during the reveal: watcher banner + unsaved-draft breadcrumb', async () => {
      await expect(tab.locator(SEL.bannerMcp)).toBeVisible({ timeout: 15_000 })
      await expectNoDialog(tab)
      await expect(breadcrumb).toContainText('Draft Workflow', { timeout: 15_000 })
      await expect(breadcrumb).not.toContainText(baseName)
    })

    const result = await build
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload.built, JSON.stringify(result.payload)).toBe(true)
    const builtId = result.payload.test_id as string

    await test.step('hand-back binds the NEW test, clean; the old test is intact', async () => {
      await expect(tab.locator(SEL.banner)).toHaveCount(0, { timeout: 15_000 })
      await expect(breadcrumb).toContainText(buildName, { timeout: 15_000 })
      await expect(tab.locator('[data-testid="toolbar-save-button"]')).toBeDisabled()
      await expectNoDialog(tab)
      await expect(tab.locator('[data-testid^="workflow-node-"][data-nodetype]')).toHaveCount(6)

      const base = await request.get(`${BACKEND_URL}/tests/${baseId}`)
      const baseData = ((await base.json()).data ?? {}) as { workflow?: { nodes?: unknown[] } }
      expect(baseData.workflow?.nodes ?? []).toHaveLength(3)

      const built = await request.get(`${BACKEND_URL}/tests/${builtId}`)
      const builtData = ((await built.json()).data ?? {}) as { workflow?: { nodes?: unknown[] } }
      expect(builtData.workflow?.nodes ?? []).toHaveLength(6)
    })
  })
})
