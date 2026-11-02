/**
 * V-PLUGIN-SSH-TUNNEL-FUNCTIONAL: SSH Tunnel pair End-to-End Execution Test
 *
 * One workflow, one run, exercising the SSH Tunnel Open / Close plugins riding
 * an open SSH Session against the real-service stack (tests/e2e/services/).
 * The tunnel destination is the internal `http-target` service - a REAL
 * remote-only endpoint (no published port), reachable ONLY through the tunnel:
 *
 *   open-session      -> session opened with a SECRET-variable password
 *   tunnel-fixed      -> forward 127.0.0.1:19446 -> http-target:9444 (fixed port)
 *   http-fixed        -> GET the forwarded health URL (proves the tunnel
 *                        carries traffic to a host WAVE cannot reach directly)
 *   tunnel-auto       -> forward with local_port 0 (auto-assign)
 *   http-auto         -> GET through the auto-assigned port
 *   close-fixed       -> closes the fixed tunnel -> closed=True
 *   close-fixed-again -> idempotent re-close of the same id -> closed=False
 *   http-after-close  -> GET through the CLOSED fixed port is REFUSED (caught)
 *   tunnel-closed     -> default tunnel to netcat-target:9479 (closed port):
 *   http-closed          opens; the GET fails (caught) with one WARN
 *   exec-late-port    -> picks a free port P on the SSH host
 *   tunnel-late       -> default tunnel to 127.0.0.1:P, nothing listening yet:
 *   http-late-before     the GET fails (caught) with one WARN; then
 *   exec-late-start      starts an HTTP server on P and waits until it listens;
 *   http-late-after      a GET through the SAME tunnel returns 200
 *   tunnel-vt-closed  -> Validate Target to the closed port fails the block (caught)
 *   exec-oneshot      -> starts a listener that accepts ONE connection, then
 *   tunnel-oneshot       Validate Target to it (the check takes that connection)
 *   http-oneshot         GET returns 200 "one-shot": the held connection reached it
 *   tunnel-blank      -> Local Port a blank expression: auto-assigns
 *   http-blank           and the GET returns 200
 *   tunnel-null-port  -> Local Port an expression returning None: the block fails
 *                        with 'local_port' is null (caught), no tunnel bound
 *   close-session     -> cascades to the still-open tunnels
 *   close-auto        -> close the auto tunnel AFTER the session close ->
 *                        closed=False (the session-close cascade already reaped it)
 *   tunnel-nofwd      -> against the AllowTcpForwarding=no host (:9448) the
 *                        listener still opens (no check at open) but
 *   http-nofwd        -> traffic through it fails (caught) with one WARN
 *   tunnel-vt-nofwd   -> Validate Target on the no-fwd host fails the block (caught)
 *
 * Proves: fixed + auto-assigned local port forwarding to a real remote-only
 * destination, explicit close (True), idempotent re-close (False), the
 * session-close cascade reaping tunnels (False), the post-close port refusing
 * connections, the default open checking nothing (SSHTUN-6), one WARN per
 * refused connection naming the SSH host's reason and none for a failed check
 * (SSHTUN-8), a destination that starts later reached by a later connection,
 * Validate Target failing on refused forwarding and on a closed port and
 * handing its held connection to the first client (SSHTUN-7), a blank
 * Local Port auto-assigning (SSH-10), and a Local Port of None failing the
 * block by the setting's name (REQ-3.1.3.21). Session outcome must be passed (the only
 * failures are caught).
 *
 * The SSH password is sourced from a SECRET variable and the test is saved
 * once (GET -> PUT round-trip) BEFORE running. The GET masks the secret to
 * "********"; if the PUT persisted the placeholder, the run would authenticate
 * with eight asterisks and fail "Permission denied".
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.5
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  getLogEntries,
  waitForLogText,
} from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  BACKEND_PORT,
  E2E_ENV_NAME,
  HTTP_TARGET_SERVICE,
  NETCAT_CLOSED_PORT,
  NETCAT_TARGET_SERVICE,
  SSH_TARGET_HOST,
  ensureEnvironment,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  injectServiceHost,
  sessionValue,
} from '../../helpers/fixture-import'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'
import fs from 'fs'
import path from 'path'

const MASK = '********'

const HTTP_TARGET = `${HTTP_TARGET_SERVICE}:9444`
const CLOSED_TARGET = `${NETCAT_TARGET_SERVICE}:${NETCAT_CLOSED_PORT}`
const WARN_PREFIX = 'Connection through SSH tunnel '
const TUNNEL_OPEN = 'SSH Tunnel Open'

/** SSHTUN-8: the WARN one refused forwarded connection writes. */
const tunnelWarn = (localPort: number, target: string, cause: string) =>
  `${WARN_PREFIX}127.0.0.1:${localPort} to ${target} failed: ${cause}`
/** SSHTUN-8: the error a failed Validate Target check fails Tunnel Open with. */
const checkFailure = (target: string, cause: string) => `SSH tunnel to ${target} failed: ${cause}`
const refusedToForward = `${SSH_TARGET_HOST} refused to forward (administratively prohibited)`
const connectionRefused = `${SSH_TARGET_HOST} could not connect (Connection refused)`

function loadFixture(): Record<string, unknown> {
  return injectServiceHost(
    JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  )
}

async function selectEnvironment(page: Page, envName: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function getNodeStatuses(page: Page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
    return Array.from(nodes).map((n) => ({
      testId: n.getAttribute('data-testid'),
      status: n.getAttribute('data-execution-status'),
      name: n.textContent?.substring(0, 80) || null,
    }))
  })
}

const NODE_IDS = [
  'open-session', 'log-open',
  'tunnel-fixed', 'log-tunnel-fixed', 'http-fixed', 'log-http-fixed',
  'tunnel-auto', 'log-tunnel-auto', 'http-auto', 'log-http-auto',
  'close-fixed', 'close-fixed-again', 'log-closes',
  'tc-post-close', 'log-post-close-caught', 'log-post-close-err',
  'close-session', 'log-session-closed', 'close-auto',
  'tunnel-closed', 'tc-closed', 'log-closed-caught', 'log-closed',
  'exec-late-port', 'tunnel-late', 'tc-late-before', 'log-late-before-caught',
  'exec-late-start', 'http-late-after', 'log-late',
  'tc-vt-closed', 'log-vt-closed-caught',
  'exec-oneshot', 'tunnel-oneshot', 'http-oneshot', 'log-oneshot',
  'tunnel-blank', 'http-blank', 'log-blank',
  'tc-null-port', 'log-null-port-caught',
  'open-nofwd', 'tunnel-nofwd', 'log-tunnel-nofwd',
  'tc-nofwd', 'log-nofwd-caught', 'log-nofwd-err',
  'tc-vt-nofwd', 'log-vt-nofwd-caught', 'log-done',
]

// The guarded probes are EXPECTED to fail (caught by their Try/Catch).
const FAILING_NODE_IDS = [
  'http-after-close', 'http-nofwd', 'http-closed', 'http-late-before',
  'tunnel-vt-closed', 'tunnel-vt-nofwd', 'tunnel-null-port',
]

/** M1: the run-time refusal of a block setting given null. */
const LOCAL_PORT_NULL = "'local_port' is null"

type FixtureNode = { id: string; data: { config: { values: Record<string, unknown> } } }

/** The config values of one fixture block. */
function nodeValues(fixture: Record<string, unknown>, id: string): Record<string, unknown> {
  const nodes = (fixture.workflow as { nodes: FixtureNode[] }).nodes
  const node = nodes.find((n) => n.id === id)
  expect(node, `fixture node ${id}`).toBeTruthy()
  return node!.data.config.values
}

test.describe('SSH Tunnel pair E2E Execution', () => {
  test('Forward (fixed + auto) through a session, close, and cascade-reap; secret survives a save', async ({ page }) => {
    const fixture = loadFixture()

    // The fixture's destinations are the stack services helpers/config.ts names.
    for (const id of ['tunnel-closed', 'tunnel-vt-closed']) {
      const values = nodeValues(fixture, id)
      expect(`${values.remote_host}:${values.remote_port}`, id).toBe(CLOSED_TARGET)
    }
    for (const id of ['tunnel-nofwd', 'tunnel-vt-nofwd', 'tunnel-blank', 'tunnel-null-port']) {
      const values = nodeValues(fixture, id)
      expect(`${values.remote_host}:${values.remote_port}`, id).toBe(HTTP_TARGET)
    }
    expect(nodeValues(fixture, 'tunnel-vt-closed').validate_target).toBe(true)
    expect(nodeValues(fixture, 'tunnel-vt-nofwd').validate_target).toBe(true)
    expect(nodeValues(fixture, 'tunnel-oneshot').validate_target).toBe(true)
    expect(nodeValues(fixture, 'tunnel-blank').local_port, 'a blank Local Port expression').toBe('')
    expect(nodeValues(fixture, 'tunnel-null-port').local_port, 'Local Port the expression None').toBe('None')

    // ---- Import + validate (zero errors before running) ----
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await ensureEnvironment(page.request)

    const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: fixture })
    const createBody = await createResp.json().catch(() => null)
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    const validateResp = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests/${testId}/validate?context=run`
    )
    const validateBody = await validateResp.json().catch(() => null)
    expect(
      validateResp.ok(),
      `Fixture validation failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`
    ).toBeTruthy()
    expect(validateBody.data?.errors ?? []).toEqual([])

    // ---- Secret round-trip guard ----
    // GET masks the secret password to the placeholder; PUT that masked payload
    // straight back. The save must keep the stored "wave-secret"; otherwise the
    // run authenticates with the placeholder and open-session raises
    // "Permission denied" below.
    await test.step('Save round-trip must not clobber the secret password', async () => {
      const getResp = await page.request.get(`http://localhost:${BACKEND_PORT}/tests/${testId}`)
      const getBody = await getResp.json()
      const stored = getBody.data
      // The round-trip is only meaningful if the GET actually masked the secret.
      expect(
        stored.variables?.ssh_pwd?.value,
        `GET should mask the secret variable to "${MASK}" - got ${JSON.stringify(stored.variables?.ssh_pwd)}`
      ).toBe(MASK)
      const putResp = await page.request.put(
        `http://localhost:${BACKEND_PORT}/tests/${testId}`,
        { data: stored }
      )
      expect(putResp.ok(), `PUT /tests round-trip failed: ${putResp.status()}`).toBeTruthy()
    })

    // ---- Navigate + run ----
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    const logs = await waitForLogText(page, 'ssh-tunnel-e2e-done')
    const all = logs.join('\n')

    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') {
      console.log('=== SSH TUNNEL WORKFLOW FAILED ===')
      console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
      console.log('logs:', all)
    }
    expect(statusVal).toBe('passed')

    const entries = await getLogEntries(page)
    const consoleText = formatEntries(entries)
    const vars = await getSessionVariables(page, await getActiveSessionId(page))
    const out = (name: string) => sessionValue(vars, name)
    const caught = (name: string) => out(name) as { message?: string; node_id?: string }

    const present = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()
    const line = (prefix: string) => logs.find((t) => t.startsWith(prefix)) ?? ''

    // ---- Secret survived the save: session opened, no auth failure ----
    await test.step('Session opened with the secret password', () => {
      present('session opened connected=True')
      expect(
        all.includes('Permission denied'),
        `Secret password was clobbered to the mask on the save round-trip.\n${all}`
      ).toBeFalsy()
    })

    // ---- Fixed-port tunnel: opened on 19446, forwards HTTP to the health target ----
    await test.step('Fixed tunnel opens on the requested port and forwards traffic', () => {
      const fixedLine = line('tunnel-fixed ')
      expect(fixedLine, `tunnel-fixed log missing.\n${all}`).toContain('tid=tunnel_')
      expect(fixedLine, `fixed tunnel should honor the requested port 19446.\n${fixedLine}`).toContain('lport=19446')

      const httpFixed = line('http-fixed ')
      expect(httpFixed, `fixed-tunnel HTTP status not 200.\n${httpFixed}`).toContain('status=200')
      expect(
        httpFixed.includes('"status"') && httpFixed.includes('"healthy"'),
        `Fixed tunnel did not carry the health response.\n${httpFixed}`
      ).toBeTruthy()
    })

    // ---- Auto-assign tunnel: resolved port returned + usable, distinct handle ----
    await test.step('Auto-assigned tunnel resolves a real port and forwards traffic', () => {
      const autoLine = line('tunnel-auto ')
      expect(autoLine, `tunnel-auto log missing.\n${all}`).toContain('tid=tunnel_')

      const autoPort = Number(autoLine.match(/lport=(\d+)/)?.[1] ?? '0')
      expect(autoPort, `local_port=0 should resolve to a real assigned port.\n${autoLine}`).toBeGreaterThan(0)
      expect(autoPort, `auto-assigned port must differ from the fixed 19446.\n${autoLine}`).not.toBe(19446)

      const fixedTid = line('tunnel-fixed ').match(/tid=(tunnel_\w+)/)?.[1]
      const autoTid = autoLine.match(/tid=(tunnel_\w+)/)?.[1]
      expect(fixedTid, 'fixed tunnel id not parsed').toBeTruthy()
      expect(autoTid, 'auto tunnel id not parsed').toBeTruthy()
      expect(autoTid, 'the two tunnels must be independent handles').not.toBe(fixedTid)

      const httpAuto = line('http-auto ')
      expect(httpAuto, `auto-tunnel HTTP status not 200.\n${httpAuto}`).toContain('status=200')
      expect(
        httpAuto.includes('"status"') && httpAuto.includes('"healthy"'),
        `Auto tunnel did not carry the health response.\n${httpAuto}`
      ).toBeTruthy()
    })

    // ---- Close: explicit close True, idempotent re-close False ----
    await test.step('Explicit close returns True; the idempotent re-close returns False', () => {
      present('close-fixed closed=True close-again closed=False')
    })

    // ---- A request through the CLOSED fixed port is refused ----
    await test.step('Post-close request through the old local port is refused', () => {
      present('post-close-caught request-refused')
      const errLine = line('post-close-err ')
      // TLS decoupling: the tlslite-backed HTTP client re-raises the raw OS error, not httpx's aggregate text
      expect(
        errLine,
        `the closed port must refuse connections.\n${errLine}`
      ).toContain('Connection refused')
    })

    // ---- Session close cascades and reaps the still-open auto tunnel ----
    await test.step('Session close cascades to tunnels; Connected flips false', () => {
      // The auto tunnel was left open; closing the session must reap it, so a
      // later close-by-id finds nothing and returns False.
      present('conn=False')
      present('close-auto-after-cascade closed=False')
    })

    // ---- Forwarding-disabled host: listener opens, traffic is refused ----
    await test.step('Tunnel on the no-fwd host opens a listener but refuses traffic', () => {
      // SSHTUN-6: the default open checks nothing, so OpenSSH with
      // AllowTcpForwarding=no refuses at CHANNEL time and the GET fails.
      const nofwdLine = line('tunnel-nofwd ')
      expect(nofwdLine, `tunnel-nofwd log missing.\n${all}`).toContain('tid=tunnel_')
      present('nofwd-caught traffic-refused')
      const errLine = line('nofwd-err ')
      expect(
        errLine,
        `the no-fwd host must drop the forwarded channel.\n${errLine}`
      ).toContain('Server disconnected without sending a response')
      // SSHTUN-8: the refusal reason reaches the run log as a WARN.
      expectConsoleLine(
        entries, 'WARN', tunnelWarn(out('lport_nofwd') as number, HTTP_TARGET, refusedToForward)
      )
    })

    await test.step('Default tunnel to a closed port opens; the GET fails with one WARN', () => {
      const localPort = out('lport_closed') as number
      expect(localPort, 'the closed-port tunnel opened on a real port').toBeGreaterThan(0)
      present('closed-caught traffic-refused')
      const error = caught('closed_err')
      expect(error.node_id, 'the caught error is the GET').toBe('http-closed')
      expect(error.message).toContain('Server disconnected without sending a response')
      expectConsoleLine(entries, 'WARN', tunnelWarn(localPort, CLOSED_TARGET, connectionRefused))
    })

    await test.step('A destination that starts later is reached through the same tunnel', () => {
      const lateTarget = `127.0.0.1:${Number(String(out('late_port_out')).trim())}`
      const localPort = out('lport_late') as number
      expect(lateTarget, 'a free port was picked on the SSH host').toMatch(/^127\.0\.0\.1:[1-9]\d*$/)
      present('late-before-caught traffic-refused')
      const error = caught('late_before_err')
      expect(error.node_id, 'the caught error is the first GET').toBe('http-late-before')
      expect(error.message).toContain('Server disconnected without sending a response')
      expectConsoleLine(entries, 'WARN', tunnelWarn(localPort, lateTarget, connectionRefused))
      expect(String(out('late_start_out')).trim(), 'the destination started listening').toBe('listening')
      expect(out('late_status'), 'the later GET through the same tunnel').toBe(200)
      present(`tunnel-late lport=${localPort} start=listening status=200`)
    })

    await test.step('Validate Target fails Tunnel Open on a closed port and on refused forwarding', () => {
      const closed = checkFailure(CLOSED_TARGET, connectionRefused)
      const nofwd = checkFailure(HTTP_TARGET, refusedToForward)
      const checks: Array<[string, string, string, string]> = [
        ['vt_closed_err', 'tunnel-vt-closed', closed, 'vt-closed-caught check-failed'],
        ['vt_nofwd_err', 'tunnel-vt-nofwd', nofwd, 'vt-nofwd-caught check-failed'],
      ]
      for (const [name, nodeId, message, marker] of checks) {
        const error = caught(name)
        expect(error.message, `${nodeId} failure`).toBe(message)
        expect(error.node_id, `${nodeId} is the failed block`).toBe(nodeId)
        expectConsoleLine(entries, 'WARN', `Try-path error caught: ${message}`)
        present(marker)
      }
      expect(out('tid_vt_closed'), 'no tunnel bound by the failed check').toBe('')
      expect(out('tid_vt_nofwd'), 'no tunnel bound by the failed check').toBe('')
    })

    await test.step('Validate Target hands its held connection to the first client', () => {
      // The listener accepts ONE connection and then stops listening: the check
      // took it, so a 200 "one-shot" proves the GET rode the held connection.
      expect(out('lport_oneshot'), 'the checked tunnel opened on a real port').toBeGreaterThan(0)
      expect(out('oneshot_status')).toBe(200)
      expect(out('oneshot_body')).toBe('one-shot')
      present('oneshot status=200 body=one-shot')
    })

    await test.step('A blank Local Port auto-assigns and forwards traffic', () => {
      const localPort = out('lport_blank') as number
      expect(localPort, 'a blank Local Port falls back to auto-assign').toBeGreaterThan(0)
      expect(out('status_blank')).toBe(200)
      expect(String(out('body_blank'))).toContain('"healthy"')
    })

    await test.step('Local Port given None fails the block with M1 and opens no tunnel', () => {
      const error = caught('null_port_err')
      expect(error.message, 'tunnel-null-port failure').toBe(LOCAL_PORT_NULL)
      expect(error.node_id, 'tunnel-null-port is the failed block').toBe('tunnel-null-port')
      expectConsoleLine(entries, 'WARN', `Try-path error caught: ${LOCAL_PORT_NULL}`)
      present('null-port-caught local-port-null')
      expect(out('tid_null_port'), 'no tunnel bound by the refused block').toBe('')
    })

    await test.step('One WARN per refused connection, attributed to its Tunnel Open, none for a failed check', async () => {
      // The copy text keeps the full source the console's source column cuts to its width;
      // its harvest order is not the run order, so both sides are sorted by message.
      const byMessage = (a: { message: string }, b: { message: string }) => a.message.localeCompare(b.message)
      const warns = consoleEntriesFromCopy(await getLogCopyTexts(page))
        .filter((e) => e.level === 'WARN' && e.message.startsWith(WARN_PREFIX))
        .map(({ source, message }) => ({ source, message }))
        .sort(byMessage)
      const lateTarget = `127.0.0.1:${Number(String(out('late_port_out')).trim())}`
      expect(warns, consoleText).toEqual([
        {
          source: blockSource(TUNNEL_OPEN, 'Default tunnel to a closed port'),
          message: tunnelWarn(out('lport_closed') as number, CLOSED_TARGET, connectionRefused),
        },
        {
          source: blockSource(TUNNEL_OPEN, 'Default tunnel, starts later'),
          message: tunnelWarn(out('lport_late') as number, lateTarget, connectionRefused),
        },
        {
          source: blockSource(TUNNEL_OPEN, 'Default tunnel on no-fwd host'),
          message: tunnelWarn(out('lport_nofwd') as number, HTTP_TARGET, refusedToForward),
        },
      ].sort(byMessage))
    })

    // ---- Bookend + every node succeeded (except the guarded probes) ----
    await test.step('Bookend + node statuses', async () => {
      present('ssh-tunnel-e2e-done')
      for (const id of NODE_IDS) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success'
        )
      }
      for (const id of ['tunnel-vt-closed', 'tunnel-vt-nofwd', 'tunnel-null-port']) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'failed'
        )
      }
      for (const id of FAILING_NODE_IDS) {
        expect(
          await page.locator(`[data-testid="workflow-node-${id}"]`).getAttribute('data-execution-status'),
          `${id} is a guarded failure probe and must not succeed`
        ).not.toBe('success')
      }
    })
  })
})
