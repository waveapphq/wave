/**
 * V-PLUGIN-SSH-SESSION-AUTH: SSH Session auth + host-key policy matrix
 *
 * One workflow, one run, against the real-service stack (tests/e2e/services/):
 * every authentication path and host-key verification policy of SSH Session
 * Open, proven against real OpenSSH hosts. WAVE's trusted hosts list is reset
 * to STACK_TRUSTED_HOSTS before and after the test (helpers/network-settings.ts):
 * the committed host key for :9445, a deliberately WRONG key for :9448,
 * nothing for :9447.
 *
 *   open-pw           -> password auth (wave / wave-secret) connects
 *   open-key          -> key auth with the committed client private key connects
 *   open-strict-ok    -> strict + the trusted correct host key connects
 *   open-strict-wrong -> strict + the wrong :9448 entry FAILS with the plugin's
 *                        exact refusal (caught; never connects)
 *   open-accept-new   -> accept-new against the untrusted :9447 connects and
 *                        adds its key to WAVE's trusted hosts list (first contact)
 *   open-disabled     -> disabled against :9447 connects
 *
 * Session outcome must be passed (the only failure is caught).
 *
 * REQ: REQ-3.4.1.3, REQ-4.5.14
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { expectConsoleLine, getLogEntries, getLogLines, waitForLogText } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  BACKEND_PORT,
  BACKEND_URL,
  E2E_ENV_NAME,
  SSH_NO_FWD_PORT,
  SSH_NO_SFTP_PORT,
  SSH_TARGET_HOST,
  ensureEnvironment,
} from '../../helpers/config'
import { injectServiceHost } from '../../helpers/fixture-import'
import { SSH_HOST_KEY, STACK_TRUSTED_HOSTS, resetNetworkSettings } from '../../helpers/network-settings'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'

const KEY_CHANGED_REFUSAL =
  `SSH host key verification failed for ${SSH_TARGET_HOST}:${SSH_NO_FWD_PORT}: the host offered a key ` +
  "that differs from the one in WAVE's trusted hosts list. Check Settings > Network > SSH Hosts"

interface TrustedHostRow {
  host: string
  port: number
  key_type: string
  fingerprint: string
}

/** `SHA256:` plus the unpadded base64 digest of the key blob, as the SSH Hosts list shows it. */
function fingerprintOf(publicKey: string): string {
  const digest = createHash('sha256').update(Buffer.from(publicKey.split(' ')[1], 'base64')).digest('base64')
  return `SHA256:${digest.replace(/=+$/, '')}`
}

async function trustedHosts(page: Page): Promise<TrustedHostRow[]> {
  const response = await page.request.get(`${BACKEND_URL}/network/ssh-hosts`)
  expect(response.ok(), `GET /network/ssh-hosts: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return body.hosts.map(({ host, port, key_type, fingerprint }: TrustedHostRow) => ({
    host,
    port,
    key_type,
    fingerprint,
  }))
}

const CLIENT_KEY_PEM = fs.readFileSync(
  path.resolve(__dirname, '../../services/sshd/keys/client_ed25519'),
  'utf-8'
)

function loadFixture(): Record<string, any> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-auth.json'), 'utf-8'))
  fixture.name = `${fixture.name} ${randomUUID().slice(0, 8)}`
  const openKey = fixture.workflow.nodes.find((n: any) => n.id === 'open-key')
  openKey.data.config.values.private_key = CLIENT_KEY_PEM
  return injectServiceHost(fixture)
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
    }))
  })
}

test.describe('SSH Session auth + host-key policy matrix E2E', () => {
  test.beforeEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test('password/key auth and all three host-key policies behave against real OpenSSH', async ({ page }) => {
    const fixture = loadFixture()
    const firstContact: TrustedHostRow = {
      host: SSH_TARGET_HOST,
      port: Number(SSH_NO_SFTP_PORT),
      key_type: 'ED25519',
      fingerprint: fingerprintOf(SSH_HOST_KEY),
    }
    const isFirstContact = (row: TrustedHostRow) =>
      row.host === firstContact.host && row.port === firstContact.port

    const before = await trustedHosts(page)
    expect(before, 'the list holds the stack hosts only').toHaveLength(STACK_TRUSTED_HOSTS.length)
    expect(before.filter(isFirstContact), ':9447 is not trusted before the run').toEqual([])

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

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    const logs = await waitForLogText(page, 'ssh-auth-e2e-done')
    const logEntries = await getLogLines(page)
    const consoleEntries = await getLogEntries(page)
    const all = logs.join('\n')

    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') {
      console.log('=== SSH AUTH WORKFLOW FAILED ===')
      console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
      console.log('logs:', all)
    }
    expect(statusVal).toBe('passed')

    const present = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    await test.step('password auth connects', () => {
      present('auth-pw connected=True')
    })

    await test.step('key auth with the committed client key connects', () => {
      present('auth-key connected=True')
    })

    await test.step('strict + the trusted correct host key connects', () => {
      present('strict-ok connected=True')
    })

    await test.step('strict + a wrong trusted key fails with the exact refusal, never connects', () => {
      present('strict-wrong-caught conn=False')
      // The refusal surfaces on the engine's caught line AND in the bound error
      // output (readable after the try/catch completes).
      expectConsoleLine(consoleEntries, 'WARN', `Try-path error caught: ${KEY_CHANGED_REFUSAL}`)
      const boundLine = logs.find((t) => t.includes('strict-err-bound')) ?? ''
      expect(
        boundLine,
        `the bound error output must carry the plugin's exact refusal.\n${boundLine}`
      ).toContain(KEY_CHANGED_REFUSAL)
      expect(
        logEntries.some((e) => e.includes('Try-path error caught')),
        'Engine should log that the strict mismatch was caught'
      ).toBeTruthy()
    })

    await test.step('accept-new connects to an untrusted host and trusts its key', async () => {
      present('accept-new connected=True')
      const after = await trustedHosts(page)
      expect(after.filter(isFirstContact), 'first contact added :9447 to the list').toEqual([firstContact])
      expect(after, 'nothing else was added').toHaveLength(STACK_TRUSTED_HOSTS.length + 1)
    })

    await test.step('disabled connects to :9447', () => {
      present('hkv-disabled connected=True')
    })

    await test.step('bookend + node statuses', async () => {
      present('ssh-auth-e2e-done')
      for (const id of [
        'open-pw', 'open-key', 'open-strict-ok', 'tc-strict-wrong',
        'log-strict-wrong', 'log-strict-err', 'open-accept-new', 'open-disabled', 'log-done',
      ]) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success'
        )
      }
      // The strict mismatch node must NOT have succeeded.
      expect(
        await page.locator('[data-testid="workflow-node-open-strict-wrong"]').getAttribute('data-execution-status')
      ).not.toBe('success')
    })
  })
})
