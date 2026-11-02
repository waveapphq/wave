/**
 * V-REMOTE-REAL-HARNESS-FUNCTIONAL: the full-chain integration over the real stack
 *
 * One workflow, one run, chaining every real-service SSH/Remote capability the
 * compose stack (tests/e2e/services/) provides - the integration form of proofs
 * whose unit forms live in the per-suite specs (ssh-session-via-parent,
 * ssh-session-script, ssh-tunnel, remote-exec):
 *
 *   open-a     -> Session A on the first real host (hop 1)
 *   open-b     -> Session B via parent A to `nested-sshd` (hop 2; the nested
 *                 host is unpublished - reachable ONLY through A; the direct-
 *                 open isolation proof is in ssh-session-via-parent)
 *   exec-b     -> real `hostname` through the chain proves B is nested-host
 *   script-*   -> sh / bash / python3 / perl / node each really RUN a piped
 *                 script over the 2-hop session (42-family computed values)
 *   tunnel-b   -> a tunnel OVER B to the internal `http-target`; a local WAVE
 *                 request through the forwarded port gets the target's real
 *                 response through both hops
 *   container  -> a Remote Execution container on B: the pushed bundle runs
 *                 under B's python3 and its HTTP block reaches the stack-only
 *                 `http-target` by service DNS (impossible from WAVE)
 *   post-close -> after Tunnel Close the old forwarded port refuses (guarded)
 *   close-a    -> closing A cascades across the real jump to B; both bound
 *                 Connected variables flip false
 *
 * REQ: REQ-3.4.1.3, REQ-3.4.1.4
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogLines, waitForLogText } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const REMOTE_URL = 'http://http-target:9444/api'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

async function getNodeStatuses(page: Page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
    return Array.from(nodes).map((n) => ({
      testId: n.getAttribute('data-testid'),
      status: n.getAttribute('data-execution-status'),
    }))
  })
}

const SUCCESS_NODE_IDS = [
  'open-a', 'open-b', 'exec-b', 'log-chain',
  'script-sh', 'script-bash', 'script-py', 'script-perl', 'script-node', 'log-scripts',
  'tunnel-b', 'http-tunnel', 'log-tunnel',
  'container', 'http-rex', 'log-rex', 'log-then',
  'close-tunnel', 'log-post-close-caught', 'log-post-close-err',
  'close-a', 'log-close', 'log-done',
]

test.describe('Remote real-service proofs (full chain)', () => {
  test('A -> B via parent -> scripts + tunnel + Remote Exec on B -> post-close refused -> cascade close', async ({ page }) => {
    test.setTimeout(180_000)
    await importValidateAndNavigate(page, loadFixture(), { injectSsh: true })

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })

    const logs = await waitForLogText(page, 'remote-harness-e2e-done')
    const logEntries = await getLogLines(page)
    const all = logs.join('\n')

    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') {
      console.log('=== REMOTE HARNESS WORKFLOW FAILED ===')
      console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
      console.log('logs:', all)
    }
    expect(statusVal).toBe('passed')

    const present = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    // ---- I/B: the real jump chain - B rides A to the unpublished nested host ----
    await test.step('B opens via parent A: hop 2, real nested-host', () => {
      present('chain a_hop=1 b_hop=2 host=nested-host')
    })

    // ---- Script: five real interpreters over the 2-hop session ----
    await test.step('sh/bash/python3/perl/node really run piped scripts on B', () => {
      present('scripts sh=42 bash=42-bash py=42 perl=42 node=42')
    })

    // ---- Tunnel: real remote-only destination through both hops ----
    await test.step('the tunnel over B carries a WAVE-local request to http-target', () => {
      present('tunnel status=200')
      const tunnelLine = logs.find((t) => t.includes('tunnel status=200')) ?? ''
      expect(tunnelLine, `the real target body must round-trip.\n${tunnelLine}`).toContain('"status":"healthy"')
    })

    // ---- Remote Exec: the pushed bundle runs under B's python3 ----
    await test.step('the remote body block reaches the stack-only target from B', () => {
      // http-target resolves only inside the stack: the real 200 + real body
      // prove the bundle's urllib executed on B, never locally on WAVE.
      present('in-body rx=200')
      const rexLine = logs.find((t) => t.includes('in-body rx=200')) ?? ''
      expect(rexLine, `the real remote response body must bind.\n${rexLine}`).toContain('"status":"healthy"')
      // The worker's captured log is replayed into the run.
      present(`HTTP 200 ${REMOTE_URL}`)
      present('then rsid_len=32 remote-exec-real')
    })

    // ---- Tunnel Close: the old forwarded port refuses ----
    await test.step('a request through the closed tunnel port is refused (caught)', () => {
      present('post-close-caught request-refused')
      const errLine = logs.find((t) => t.includes('post-close-err')) ?? ''
      expect(errLine, `the bound post-close error must surface.\n${errLine}`).toContain('closed=True')
      // TLS decoupling: the tlslite backend re-raises the raw OS error (was httpx's aggregate text).
      expect(errLine, `the refusal must be a real connection failure.\n${errLine}`).toContain('Connection refused')
      expect(
        logEntries.some((e) => e.includes('Try-path error caught')),
        'Engine should log that the post-close refusal was caught'
      ).toBeTruthy()
    })

    // ---- Cascade close across the real jump ----
    await test.step('closing A cascades to B; Connected flips false on both', () => {
      present('a_conn=False b_conn=False')
      const closeLine = logs.find((t) => t.includes('a_conn=False b_conn=False')) ?? ''
      const closedCount = (closeLine.match(/ssh_session_/g) ?? []).length
      expect(closedCount, `Close should report 2 cascaded session ids.\n${closeLine}`).toBe(2)
    })

    // ---- Bookend + node statuses ----
    await test.step('node statuses', async () => {
      present('remote-harness-e2e-done')
      for (const id of SUCCESS_NODE_IDS) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success'
        )
      }
      // The guarded probe itself must have FAILED (the refusal is real).
      await expect(page.locator('[data-testid="workflow-node-http-post-close"]')).not.toHaveAttribute(
        'data-execution-status',
        'success'
      )
    })
  })
})
