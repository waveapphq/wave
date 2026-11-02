/**
 * V-PLUGIN-REMOTE-EXEC-TLS-FUNCTIONAL: remote-path TLS parity on the real wire.
 *
 * The remote worker shares WAVE's pure-Python TLS engine, so a Remote Execution
 * body block puts the same bytes on the wire as a local block. These runs push
 * the real bundle over an SSH session (`sshd`) and hit the stack's internal
 * services by compose DNS (unreachable from WAVE - so a real 200 proves the
 * request ran on the host). Proves:
 *   - PERM-10: remote verify-on + CA reaches http-target:9443 (200); verify-on
 *     WITHOUT a CA fails with the exact `Certificate verification failed: ...`
 *     surfaced in the replayed console (second test, workflow fails).
 *   - REQ-4.5.16: remote verify-on with a blank CA and the lab CA saved in
 *     Additional Certificates reaches http-target:9443 (200) - the certificates
 *     travel with the run (third test).
 *   - PERM-5:  remote mutual TLS at TLS 1.3 to tls-lab:9451 binds the client DN;
 *     the client key masks in the replayed console.
 *   - PERM-18: remote allow_redirects=false surfaces 302 as the final status.
 *   - a remote version pin (1.2) negotiates against the tls12 listener.
 *   - guard 13: a remote GET-with-body + Basic-auth composition reaches the
 *     server, and a remote response Set-Cookie credential masks over the
 *     replayed path.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/remote-exec/v-plugin-remote-exec-tls-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  waitForLogText,
  getLogCopyTexts,
  getLogEntries,
  setConsoleMinimumLevel,
} from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  injectServiceHost,
  sessionValue,
} from '../../helpers/fixture-import'
import { resetNetworkSettings } from '../../helpers/network-settings'
import { selectEnvironment } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  BACKEND_URL,
  ensureEnvironment,
  CA_CERT_PEM,
  TLS_LAB_CLIENT_CERT_PEM,
  TLS_LAB_CLIENT_KEY_PEM,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// The tls-lab client identity subject (nginx echoes $ssl_client_s_dn).
const CLIENT_CN = 'wave-e2e-client'
// The /cookie endpoint's server-side default credential (server.ts).
const COOKIE_SECRET = 'wave-c00kie-s3cr3t-4417'
const AUTH_PW = 'remote-basic-pw-7g3k'
// A distinctive slice of the plain client key body used as the leak canary.
const KEY_CANARY = TLS_LAB_CLIENT_KEY_PEM.split('\n')
  .filter((l) => l && !l.includes('-----'))
  .join('')
  .slice(20, 60)

function loadFixture(name: string, withMaterial: boolean): Record<string, any> {
  const fixture = injectServiceHost(
    JSON.parse(fs.readFileSync(path.resolve(__dirname, name), 'utf-8')),
  ) as Record<string, any>
  // The no-CA negative fixture intentionally has no ca_pem variable.
  if (fixture.variables.ca_pem) fixture.variables.ca_pem.value = CA_CERT_PEM
  if (withMaterial) {
    fixture.variables.client_cert_pem.value = TLS_LAB_CLIENT_CERT_PEM
    fixture.variables.client_key_pem.value = TLS_LAB_CLIENT_KEY_PEM
    fixture.variables.auth_pw.value = AUTH_PW
  }
  fixture.name = `${fixture.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

async function importValidateOpen(page: Page, fixture: Record<string, any>): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await ensureEnvironment(page.request)
  const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: fixture })
  const createBody = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
  ).toBeTruthy()
  const testId = createBody.data?.id || createBody.id

  const validateResp = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate?context=run`)
  const validateBody = await validateResp.json().catch(() => null)
  expect(
    validateResp.ok(),
    `validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`,
  ).toBeTruthy()
  expect(validateBody.data?.errors ?? []).toEqual([])

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

test.describe('Remote Execution TLS parity (real wire)', () => {
  // The negative case needs a blank CA to trust nothing the lab CA signed.
  test.beforeEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test('remote verify-on, mTLS, redirects-off, version pin, cookie/auth masking', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const fixture = loadFixture('fixture-tls.json', true)
    await importValidateOpen(page, fixture)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })

    const logs = await waitForLogText(page, 'remote-tls-done')
    const all = logs.join('\n')
    if ((await status.getAttribute('data-status')) !== 'passed') {
      console.log('=== REMOTE TLS FAILED ===')
      console.log(all)
    }
    expect(await status.getAttribute('data-status')).toBe('passed')

    const body = logs.find((t) => t.includes('remote-tls-body-done')) ?? ''

    // ---- PERM-10 positive: remote verify-on + CA reaches the host target ----
    await test.step('PERM-10: remote verify-on + CA -> 200 on the host', () => {
      expect(body, all).toContain('rx=200')
    })

    // ---- PERM-5: remote mTLS at TLS 1.3 binds the verified client DN on the host ----
    // The node pins min=max=1.3, so a 200 from the mTLS listener proves the bundled
    // engine carried mutual TLS at 1.3 over the real remote (sshd) path.
    await test.step('PERM-5: remote mTLS at TLS 1.3 binds the client DN (server fact)', () => {
      expect(body, all).toContain('mtls=200')
      expect(body, all).toContain(CLIENT_CN)
      expect(body, all).toContain('"listener":"mtls"')
      expect(body, all).toContain('"ssl_protocol":"TLSv1.3"')
    })

    // ---- PERM-18: remote redirects-off surfaces 302 as final ----
    await test.step('PERM-18: remote allow_redirects=false -> 302 final', () => {
      expect(body, all).toContain('redir=302')
    })

    // ---- remote version pin negotiates against the tls12 listener ----
    await test.step('remote version pin 1.2 vs the tls12 listener', () => {
      expect(body, all).toContain('ver=200')
      expect(body, all).toContain('"ssl_protocol":"TLSv1.2"')
      expect(body, all).toContain('"listener":"tls12"')
    })

    // ---- guard 13: remote GET-with-body + auth reaches the server ----
    await test.step('guard 13: remote GET-with-body + Basic auth reached the server', () => {
      expect(body, all).toContain('auth=200')
      // The echo (bodies collected on all methods) carries the GET request body.
      expect(body, all).toContain('remote-get-body')
    })

    // ---- guard 13 + PERM-5: cookie, auth password, client key all mask ----
    await test.step('cookie credential, auth password, and client key never leak', async () => {
      const copy = await getLogCopyTexts(page)
      const both = [...logs, ...copy].join('\n')
      expect(body, all).toContain('ck=200')
      expect(both, 'the response Set-Cookie credential must mask').not.toContain(COOKIE_SECRET)
      expect(both, 'the auth password must mask over the remote path').not.toContain(AUTH_PW)
      expect(both, 'the client key must never render in cleartext').not.toContain(KEY_CANARY)
      // The composed auth password renders masked in the body log.
      expect(body, all).toContain('authpw=********')
    })

    // ---- node statuses ----
    await test.step('node statuses: the container and body blocks all succeeded', async () => {
      for (const id of ['container', 'r-verify', 'r-mtls', 'r-noredir', 'r-version', 'r-cookie', 'r-auth']) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success',
        )
      }
    })
  })

  test('PERM-10 negative: remote verify-on without a CA fails with the exact message', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const fixture = loadFixture('fixture-tls-noca.json', false)
    await importValidateOpen(page, fixture)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })

    // The workflow fails; the exact verification message surfaces in the replayed console.
    const logs = await waitForLogText(page, 'Certificate verification failed', 120_000)
    const all = logs.join('\n')
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })

    await test.step('the exact no-trusted-issuer message surfaces; no bytes left WAVE trusted', () => {
      expect(
        logs.some((t) =>
          t.includes('Certificate verification failed: no trusted issuer found for certificate'),
        ),
        `expected the exact no-CA verification message.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('the run failed and the remote block is painted failed', async () => {
      expect(await status.getAttribute('data-status')).toBe('failed')
      await expect(page.locator('[data-testid="workflow-node-r-noca"]')).toHaveAttribute(
        'data-execution-status',
        'failed',
      )
    })
  })

  test('REQ-4.5.16: remote verify-on with a blank CA trusts the Additional Certificates', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const saved = await page.request.patch(`${BACKEND_URL}/network/certificates`, {
      data: { add: [CA_CERT_PEM] },
    })
    const savedText = await saved.text()
    expect(saved.ok(), `PATCH /network/certificates: ${saved.status()} ${savedText}`).toBeTruthy()
    const view = JSON.parse(savedText)
    const label: string = (view.data ?? view).settings.builtin.label
    expect((view.data ?? view).additional).toHaveLength(1)

    const fixture = loadFixture('fixture-tls-noca.json', false)
    await importValidateOpen(page, fixture)

    // The trust line is DEBUG (REQ-4.5.16).
    await setConsoleMinimumLevel(page, 'DEBUG')
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })

    const logs = await waitForLogText(page, 'remote-noca-then-done', 30_000)
    const all = logs.join('\n')

    await test.step('the run passed and the remote block reached the host target (200)', async () => {
      expect(await status.getAttribute('data-status'), all).toBe('passed')
      await expect(page.locator('[data-testid="workflow-node-r-noca"]')).toHaveAttribute(
        'data-execution-status',
        'success',
      )
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(sessionValue(variables, 'nc_status')).toBe(200)
    })

    await test.step('the remote worker trusted the built-in list plus the one saved certificate', async () => {
      const entries = await getLogEntries(page)
      expect(
        entries.filter((e) => e.message.startsWith('Trusting ')).map((e) => `${e.level} ${e.message}`),
        all,
      ).toEqual([`DEBUG Trusting WAVE's built-in certificate list (${label}) and 1 additional certificate`])
      expect(all).not.toContain('Certificate verification failed')
    })
  })
})
