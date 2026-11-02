/**
 * V-WAVE-SERVER-SESSIONS-FUNCTIONAL: browser sessions as first-class, terminable connections
 * Design Decisions: WSRV-1..9
 * REQ: REQ-5.2.7.15
 *
 * Every assertion anchors on persisted / observable state - the backend
 * /server/status roster + roles, the rendered role pills, the terminated
 * tab's redirect + modal - so losing a behavior breaks the test.
 *
 * Pass Criteria:
 * 1. A real holder + mirror appear in the roster with the holder marked
 *    Active and the mirror Watching (persisted /server/status roles AND the
 *    rendered pills).
 * 2. Part 0 (behavioral-loss): the person mirror banner names the connection
 *    identity and its (now ungated) See Connection deep-links to the holder's
 *    Active row in /settings/server - highlighted, no "From your workbench" chip.
 * 3. Disconnecting a session from the roster ends it end-to-end: the target
 *    tab is booted to /dashboard with the admin-disconnect modal, its row
 *    leaves the roster, and it does not silently reappear.
 * 4. Disconnect Others spares the caller and boots the rest; Disconnect All
 *    then boots the caller too.
 * 5. Closing a workbench tab removes its session from the roster promptly
 *    (graceful leave), and the Frontend fact card advertises a single origin.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import type { APIRequestContext } from '../../helpers/playwright-fixtures'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { BACKEND_URL, FRONTEND_URL } from '../../helpers/config'
import {
  SEL,
  openHolderAndMirror,
  openWorkbench,
  ownershipState,
  resetOwnership,
  waitUntilHeld,
} from '../../helpers/ownership'

interface ServerFacts {
  running: boolean
  urls: string[]
  port: number
  bind: string
}
interface ServerStatus {
  frontend: ServerFacts
  backend: ServerFacts
  session_count: number
  sessions: { session_id: string; client: string; ip: string }[]
  active_session_id: string | null
  watching_session_ids: string[]
}

async function serverStatus(request: APIRequestContext): Promise<ServerStatus> {
  const resp = await request.get(`${BACKEND_URL}/server/status`)
  expect(resp.ok(), `GET /server/status failed: ${resp.status()}`).toBeTruthy()
  return (await resp.json()) as ServerStatus
}

async function hasSession(request: APIRequestContext, id: string): Promise<boolean> {
  return (await serverStatus(request)).sessions.some((row) => row.session_id === id)
}

/** Open an isolated viewer context on a path (a distinct browser watching the roster). */
async function openViewer(
  browser: Browser,
  open: BrowserContext[],
  path: string,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  open.push(context)
  const page = await context.newPage()
  await page.goto(path)
  return page
}

/** The one watcher id, once the roster reports the holder Active + a Watching mirror. */
async function waitForRoles(request: APIRequestContext, activeId: string): Promise<string> {
  await expect
    .poll(
      async () => {
        const s = await serverStatus(request)
        return s.active_session_id === activeId && s.watching_session_ids.length >= 1
      },
      { timeout: 15_000, message: 'roster reports the holder Active and a Watching mirror' },
    )
    .toBe(true)
  return (await serverStatus(request)).watching_session_ids[0]
}

const open: BrowserContext[] = []

test.describe('V-WAVE-SERVER-SESSIONS-FUNCTIONAL: first-class terminable connections', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('roster lists real workbench sessions with Active (holder) and Watching (mirror) roles', async ({
    browser,
    request,
  }) => {
    const { b } = await openHolderAndMirror(browser, request, (c) => open.push(c))
    const activeId = (await ownershipState(request)).holder!.id
    const watchingId = await waitForRoles(request, activeId)

    // Persisted roster: both sessions present, exactly one Active (the holder).
    const status = await serverStatus(request)
    expect(status.sessions.map((r) => r.session_id)).toEqual(
      expect.arrayContaining([activeId, watchingId]),
    )
    expect(status.active_session_id).toBe(activeId)
    expect(status.watching_session_ids).toContain(watchingId)
    // The mirror sees the person banner (holder != self).
    await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()

    // Rendered pills on a neutral roster viewer.
    const viewer = await openViewer(browser, open, '/settings/server')
    const activeRow = viewer.locator(`[data-testid="server-session-row-${activeId}"]`)
    const watchRow = viewer.locator(`[data-testid="server-session-row-${watchingId}"]`)
    await expect(activeRow.getByText('Active', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(watchRow.getByText('Watching', { exact: true })).toBeVisible({ timeout: 10_000 })
  })

  test('the person banner names the connection and See Connection deep-links to the holder\'s Active row', async ({
    browser,
    request,
  }) => {
    const { b } = await openHolderAndMirror(browser, request, (c) => open.push(c))
    const activeId = (await ownershipState(request)).holder!.id
    await waitForRoles(request, activeId)

    // Part 0 (banner identity): the person holder is named by its connection,
    // and See Connection is shown for a person holder.
    await expect(b.page.locator(SEL.bannerPerson)).toBeVisible()
    await expect(b.page.locator(SEL.banner)).toContainText('another session on ')
    await expect(
      b.page.locator(SEL.seeConnection),
      'See Connection is ungated for a person holder',
    ).toBeVisible()

    // Part 0 (deep-link): See Connection lands on the holder's row in /settings/server,
    // highlighted + labeled Active, with NO "From your workbench" chip (that is MCP-only).
    await b.page.locator(SEL.seeConnection).click()
    await b.page.waitForURL(
      (url) => url.pathname === '/settings/server' && url.searchParams.get('session') === activeId,
    )
    const row = b.page.locator(`[data-testid="server-session-row-${activeId}"]`)
    await expect(row).toHaveAttribute('data-highlighted', 'true', { timeout: 10_000 })
    await expect(row.getByText('Active', { exact: true })).toBeVisible()
    await expect(row).not.toContainText('From your workbench')
  })

  test('Disconnect from the roster boots that tab to the dashboard and drops its row for good', async ({
    browser,
    request,
  }) => {
    const { a, b } = await openHolderAndMirror(browser, request, (c) => open.push(c))
    const activeId = (await ownershipState(request)).holder!.id
    const watchingId = await waitForRoles(request, activeId)

    const viewer = await openViewer(browser, open, '/settings/server')
    const targetRow = viewer.locator(`[data-testid="server-session-row-${watchingId}"]`)
    await expect(targetRow).toBeVisible({ timeout: 10_000 })

    // Confirmation-gated per-row Disconnect (WSRV-5).
    await targetRow.getByRole('button', { name: 'Disconnect' }).click()
    const dialog = viewer.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Disconnect' }).click()

    // The booted mirror tab redirects to /dashboard and shows the admin modal.
    await expect(b.page.locator('[data-testid="admin-disconnect-dialog"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect(b.page).toHaveURL(/\/dashboard/)
    // The holder tab is untouched.
    await expect(a.page.locator('[data-testid="admin-disconnect-dialog"]')).toHaveCount(0)

    // The session leaves the roster and does NOT silently reappear (no auto-reconnect).
    await expect
      .poll(async () => hasSession(request, watchingId), { timeout: 15_000 })
      .toBe(false)
    await expect(targetRow).toHaveCount(0, { timeout: 10_000 })
    await viewer.waitForTimeout(2_000)
    expect(await hasSession(request, watchingId)).toBe(false)
  })

  test('Disconnect Others spares the caller and boots the rest; Disconnect All then boots the caller too', async ({
    browser,
    request,
  }) => {
    const { a, b } = await openHolderAndMirror(browser, request, (c) => open.push(c))
    const activeId = (await ownershipState(request)).holder!.id
    const watchingId = await waitForRoles(request, activeId)

    // Disconnect Others with the HOLDER as the caller -> only the mirror is booted.
    const othersResp = await request.post(`${BACKEND_URL}/server/sessions/disconnect-others`, {
      data: { requester_session_id: activeId },
    })
    expect(othersResp.ok()).toBeTruthy()
    expect((await othersResp.json()).disconnected).toBe(1)

    // The caller survives (still present + still Active), the other is gone + booted.
    await expect
      .poll(
        async () => {
          const s = await serverStatus(request)
          return (
            s.sessions.some((r) => r.session_id === activeId) &&
            !s.sessions.some((r) => r.session_id === watchingId)
          )
        },
        { timeout: 15_000, message: 'the caller survives, the other is gone' },
      )
      .toBe(true)
    expect((await serverStatus(request)).active_session_id).toBe(activeId)
    await expect(b.page.locator('[data-testid="admin-disconnect-dialog"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      a.page.locator('[data-testid="admin-disconnect-dialog"]'),
      'the caller session is not terminated',
    ).toHaveCount(0)

    // Disconnect All -> the caller (holder) is booted too.
    const allResp = await request.post(`${BACKEND_URL}/server/sessions/disconnect-all`, {
      data: {},
    })
    expect(allResp.ok()).toBeTruthy()
    expect((await allResp.json()).disconnected).toBeGreaterThanOrEqual(1)
    await expect(a.page.locator('[data-testid="admin-disconnect-dialog"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect.poll(async () => hasSession(request, activeId), { timeout: 15_000 }).toBe(false)
  })

  test('closing a workbench tab removes its session from the roster promptly', async ({
    browser,
    request,
  }) => {
    const a = await openWorkbench(browser)
    open.push(a.context)
    const holder = await waitUntilHeld(request)
    await expect.poll(async () => hasSession(request, holder.id), { timeout: 15_000 }).toBe(true)

    // A real tab close drops the socket; the roster row is reaped on disconnect.
    await a.context.close()
    await expect
      .poll(async () => hasSession(request, holder.id), {
        timeout: 20_000,
        message: 'the closed tab leaves the roster',
      })
      .toBe(false)
  })

  test('the Frontend Server fact card advertises the single serving origin', async ({ browser }) => {
    const viewer = await openViewer(browser, open, '/settings/server')
    const frontendCard = viewer.locator('[data-testid="server-card-frontend"]')
    await expect(frontendCard).toContainText('Frontend Server', { timeout: 10_000 })
    // Facts derive from the request Origin: exactly one origin, never a CORS list.
    await expect(frontendCard.getByRole('button', { name: /^Copy / })).toHaveCount(1)
  })
})
