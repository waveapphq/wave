/**
 * V-SESS-MIRROR-FUNCTIONAL: Live single-writer mirroring + read-only lock
 * Design Decisions: SESS-1..4
 * REQ: REQ-5.2.7.15
 *
 * Pass Criteria:
 * 1. One holder edits; every other viewer mirrors the SAME canvas node and
 *    the SAME Variable Manager variable live (persisted/observable state).
 * 2. The mirror is read-only: canvas data-readonly, environment selector +
 *    debug gear + Run + Debug disabled, Variable Manager exposes no create
 *    and no row mutation. The holder's identical controls stay enabled.
 * 3. A person holder is named generically ("another session"), never a raw
 *    per-tab id.
 * 4. The holder asserts liveness for as long as it holds the session,
 *    and the "N watching" pill appears when a mirror joins and drops when it
 *    leaves.
 * 5. An assistant-held mirror shows See connection, which deep-links to the
 *    highlighted MCP session in Settings.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import type { BrowserContext } from '@playwright/test'
import { dragPaletteItemToCanvas, stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'
import { createSimpleVariable, expandVariableManager, variableRow } from '../../helpers/variable-create'
import { FRONTEND_URL } from '../../helpers/config'
import {
  SEL,
  mockMcpSessions,
  mockOwnershipHolder,
  nodeIds,
  openWorkbench,
  resetOwnership,
  waitUntilHeld,
} from '../../helpers/ownership'

const open: BrowserContext[] = []

test.describe('V-SESS-MIRROR-FUNCTIONAL: live mirroring & read-only lock', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('canvas + variables mirror live and the mirror is read-only', async ({ browser, request }) => {
    // Holder (A) claims on mount; a mirror (B) joins read-only.
    const a = await openWorkbench(browser)
    open.push(a.context)
    const holder = await waitUntilHeld(request)
    expect(holder.kind).toBe('person')
    await expect(a.page.locator(SEL.banner), 'the holder sees no mirror banner').toHaveCount(0)

    const b = await openWorkbench(browser)
    open.push(b.context)
    await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.page.locator(SEL.canvasReadOnly)).toBeVisible()

    // Generic person wording: never a raw per-tab id.
    await expect(b.page.locator(SEL.banner)).toContainText('another session')
    await expect(b.page.locator(SEL.banner)).toContainText('read-only, updates as they edit')
    await expect(b.page.locator(SEL.banner), 'no raw tab id in the banner').not.toContainText('Tab')

    // Read-only lock vs the holder's live controls (env + debug gear).
    await expect(a.page.locator(SEL.envSelector)).toBeEnabled()
    await expect(a.page.locator(SEL.debugGear)).toBeEnabled()
    await expect(b.page.locator(SEL.envSelector)).toBeDisabled()
    await expect(b.page.locator(SEL.debugGear)).toBeDisabled()
    await expect(b.page.locator(SEL.runButton)).toBeDisabled()
    await expect(b.page.locator(SEL.debugButton)).toBeDisabled()

    // Live canvas mirror: the exact node dropped in A appears in B.
    const before = await nodeIds(b.page)
    const canvasBox = await a.page.locator(SEL.canvas).boundingBox()
    await dragPaletteItemToCanvas(a.page, 'shell script', {
      x: canvasBox!.width / 2,
      y: canvasBox!.height / 2,
    })
    const afterIds = await nodeIds(a.page)
    const newId = afterIds.find((id) => !before.includes(id))
    expect(newId, 'a node was created in the holder tab').toBeTruthy()
    await expect(b.page.locator(`[data-testid="workflow-node-${newId}"]`)).toBeVisible({
      timeout: 10_000,
    })

    // Live variable mirror: a variable created in A appears in B's manager.
    await createSimpleVariable(a.page, 'mirror_var', { value: 'mirror-value' })
    await expandVariableManager(b.page)
    await expect(variableRow(b.page, 'mirror_var')).toBeVisible({ timeout: 10_000 })

    // The mirror's Variable Manager offers no create and no row mutation.
    await expect(b.page.locator(SEL.addVariable), 'no + Add while mirroring').toHaveCount(0)
    await expect(
      b.page.locator('[data-testid^="edit-button-"]').first(),
      'mirrored rows are not editable',
    ).toHaveAttribute('aria-disabled', 'true')
  })

  test('the holder asserts liveness for as long as it holds, and the watching pill tracks the mirror', async ({
    browser,
    request,
  }) => {
    const heartbeats: string[] = []
    const a = await openWorkbench(browser)
    open.push(a.context)
    a.page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/workbench/ownership/heartbeat') heartbeats.push(req.url())
    })
    await waitUntilHeld(request)

    // Liveness belongs to the tab, not to who is watching: a solo holder
    // signals too, so a holder is never reaped as abandoned when somebody
    // starts watching.
    await expect(a.page.locator(SEL.watchers)).toHaveCount(0)
    await expect
      .poll(() => heartbeats.length, {
        timeout: 20_000,
        message: 'a solo holder still asserts liveness',
      })
      .toBeGreaterThan(0)

    // A mirror joins: the pill shows "1 watching".
    const b = await openWorkbench(browser)
    open.push(b.context)
    await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(a.page.locator(SEL.watchers)).toBeVisible()
    await expect(a.page.locator(SEL.watchers)).toContainText('1 watching')

    // The mirror leaves: the watcher count (and pill) drop promptly.
    await b.context.close()
    await expect(a.page.locator(SEL.watchers)).toHaveCount(0, { timeout: 15_000 })
  })

  test('assistant-held mirror: See connection opens the highlighted MCP session', async ({
    browser,
  }) => {
    const sessionId = 'e2e-mcp-see-conn-1'
    const context = await browser.newContext({ baseURL: FRONTEND_URL })
    open.push(context)
    const page = await context.newPage()
    await stubSessionRecovery(page)
    await mockOwnershipHolder(page, { id: sessionId, label: 'Claude Code (MCP)', kind: 'mcp' })
    await mockMcpSessions(page, sessionId)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Violet MCP banner names the assistant by its real name and offers See connection.
    await expect(page.locator(SEL.bannerMcp)).toBeVisible()
    await expect(page.locator(SEL.banner)).toContainText('Claude Code (MCP)')
    await expect(page.locator(SEL.seeConnection)).toBeVisible()

    // See connection deep-links to the MCP settings with that session highlighted.
    await page.locator(SEL.seeConnection).click()
    await page.waitForURL(`**/settings/mcp?session=${sessionId}`)
    const row = page.locator(`[data-testid="mcp-session-row-${sessionId}"]`)
    await expect(row).toHaveAttribute('data-highlighted', 'true')
    await expect(row).toContainText('From your workbench')
  })
})
