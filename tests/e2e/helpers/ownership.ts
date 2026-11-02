/**
 * Session-ownership E2E helpers.
 *
 * The workbench editing lock is a single GLOBAL server slot: one holder
 * mutates, every other viewer mirrors read-only. These helpers open isolated
 * browser contexts (two "users"), reset the global slot between tests, and
 * mock the assistant-holder (MCP) states a person-only E2E cannot reach.
 */

import { expect } from './playwright-fixtures'
import type { APIRequestContext, Page } from './playwright-fixtures'
import type { Browser, BrowserContext } from '@playwright/test'
import { BACKEND_URL, FRONTEND_URL } from './config'
import { stubSessionRecovery, waitForCanvasLoad } from './canvas'

/** Selectors for the ownership chrome (banner, dialogs, locked controls). */
export const SEL = {
  banner: '[data-testid="mirror-banner"]',
  bannerPerson: '[data-testid="mirror-banner"][data-holder-kind="person"]',
  bannerMcp: '[data-testid="mirror-banner"][data-holder-kind="mcp"]',
  takeOver: '[data-testid="mirror-take-over-button"]',
  seeConnection: '[data-testid="mirror-see-connection-button"]',
  watchers: '[data-testid="watchers-indicator"]',
  canvas: '[data-testid="workflow-canvas"]',
  canvasReadOnly: '[data-testid="workflow-canvas"][data-readonly="true"]',
  envSelector: '[data-testid="environment-selector"]',
  debugGear: '[data-testid="debug-options-gear"]',
  runButton: '[data-testid="run-button"]',
  debugButton: '[data-testid="debug-button"]',
  addVariable: '[data-testid="add-variable-button"]',
  watchSession: '[data-testid="mirror-watch-session-button"]',
  followChanges: '[data-testid="mirror-follow-changes-button"]',
  focusCurrent: '[data-testid="action-focus-current-button"]',
} as const

export interface Holder {
  id: string
  label: string
  kind: 'person' | 'mcp'
}

/** Wire shape of the announced run carried by ownership state (snake_case). */
export interface MirroredRunWire {
  session_id: string
  test_id: string
  test_name: string
  environment_id: string | null
  environment_name: string | null
  status: string
}

export interface OwnershipData {
  holder: Holder | null
  watchers: number
  pending_takeover: { requester_label: string } | null
  run?: MirroredRunWire | null
}

const RESET_ID = 'e2e-ownership-reset'

/** Free the single global ownership slot no matter who holds it (force then release). */
export async function resetOwnership(request: APIRequestContext): Promise<void> {
  await request.post(`${BACKEND_URL}/workbench/ownership/takeover/force`, {
    data: { requester_id: RESET_ID, requester_label: 'E2E Reset' },
  })
  await request.post(`${BACKEND_URL}/workbench/ownership/release`, {
    data: { holder_id: RESET_ID },
  })
}

/** Current server-side ownership state (holder / watchers / pending take-over). */
export async function ownershipState(request: APIRequestContext): Promise<OwnershipData> {
  const resp = await request.get(`${BACKEND_URL}/workbench/ownership`)
  const body = await resp.json()
  return body.data as OwnershipData
}

/** POST the /leaving beacon a real tab close sends, to deterministically free a holder. */
export async function leaveOwnership(request: APIRequestContext, holderId: string): Promise<void> {
  await request.post(`${BACKEND_URL}/workbench/ownership/leaving`, {
    data: { holder_id: holderId },
  })
}

/** Poll until the slot is held, then return the holder. */
export async function waitUntilHeld(request: APIRequestContext): Promise<Holder> {
  await expect
    .poll(async () => (await ownershipState(request)).holder !== null, {
      timeout: 15_000,
      message: 'expected the workbench ownership slot to be claimed',
    })
    .toBe(true)
  return (await ownershipState(request)).holder as Holder
}

/** Ids of every workflow node currently on the canvas (drill-aware wrappers only). */
export async function nodeIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('workflow-node-', '')),
    )
}

/** Open a fresh isolated browser context on /workbench (a distinct "user"). */
export async function openWorkbench(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  const page = await context.newPage()
  await stubSessionRecovery(page)
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  return { context, page }
}

/** Open a holder (A) that claims on mount, then a mirror (B) that shows the banner. */
export async function openHolderAndMirror(
  browser: Browser,
  request: APIRequestContext,
  track: (context: BrowserContext) => void,
): Promise<{
  a: { context: BrowserContext; page: Page }
  b: { context: BrowserContext; page: Page }
}> {
  const a = await openWorkbench(browser)
  track(a.context)
  await waitUntilHeld(request)
  const b = await openWorkbench(browser)
  track(b.context)
  await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()
  return { a, b }
}

/** Intercept GET /workbench/ownership so the page renders a chosen holder read-only. */
export async function mockOwnershipHolder(
  page: Page,
  holder: Holder,
  watchers = 0,
  run: MirroredRunWire | null = null,
): Promise<void> {
  const data: OwnershipData & { you_are_holder: boolean; mcp_session_id: string | null } = {
    holder,
    watchers,
    pending_takeover: null,
    run,
    you_are_holder: false,
    mcp_session_id: holder.kind === 'mcp' ? holder.id : null,
  }
  await page.route(
    (url) => url.pathname === '/workbench/ownership',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { success: true, data } })
        : route.continue(),
  )
}

/** Mock the MCP settings tab data so a single session row renders (See connection target). */
export async function mockMcpSessions(
  page: Page,
  sessionId: string,
  client = 'claude-code',
): Promise<void> {
  const status = {
    running: true,
    enabled: true,
    until_restart_active: false,
    port: 8765,
    bind: 'local',
    urls: ['http://127.0.0.1:8765/mcp'],
    connected_clients: 1,
    sessions: [
      {
        session_id: sessionId,
        client,
        client_version: '2.1.0',
        ip: '127.0.0.1',
        connected_at: '2026-07-20T14:00:02Z',
        last_activity: '2026-07-20T14:02:31Z',
      },
    ],
    recent_activity: [],
    last_error: null,
  }
  const settings = {
    enabled: true,
    until_restart_active: false,
    port: 8765,
    bind: 'local',
    auth_enabled: false,
    auth_username: '',
    auth_password_set: false,
    running: true,
    server_port: 8000,
  }
  await page.route(
    (url) => url.pathname === '/mcp/status',
    (route) => (route.request().method() === 'GET' ? route.fulfill({ json: status }) : route.continue()),
  )
  await page.route(
    (url) => url.pathname === '/mcp/settings',
    (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: settings }) : route.continue(),
  )
}
