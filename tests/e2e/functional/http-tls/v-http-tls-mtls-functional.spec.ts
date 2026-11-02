/**
 * V-HTTP-TLS-MTLS-FUNCTIONAL: mutual-TLS client identity on the real wire.
 *
 * Drives the HTTP plugin locally on WAVE against the tls-lab mTLS listener
 * (9451, `ssl_verify_client on`, TLS 1.0-1.3). The listener echoes the verified
 * client DN + negotiated protocol as JSON (server fact); the DEBUG connect
 * trace shows the protocol (UI fact). The committed client identity is signed
 * by the same WAVE Test CA the server trusts. Proves:
 *   - PERM-1: TLS 1.2 with a PEM client cert, server verified via the WAVE CA,
 *     the listener reports the client DN, and the client key masks everywhere.
 *   - PERM-2: pinning max 1.3 with a client cert negotiates TLS 1.3 (client-cert compression off).
 *   - PERM-3: pinned 1.0 and 1.1 client auth negotiate.
 *   - missing client identity to 9451 is rejected in the handshake (caught).
 *   - the connect entry renders "TLS TLSv1.X, cipher TLS_...".
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/http-tls/v-http-tls-mtls-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts, waitForLogText } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import {
  CA_CERT_PEM,
  TLS_LAB_CLIENT_CERT_PEM,
  TLS_LAB_CLIENT_KEY_PEM,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const CLIENT_CN = 'wave-e2e-client'

/** A distinctive slice of the plain client key's base64 body, used as the leak
 *  canary: it must never render in the console in cleartext. */
function keyCanary(pem: string): string {
  const body = pem
    .split('\n')
    .filter((l) => l && !l.includes('-----'))
    .join('')
  return body.slice(20, 60)
}

function loadFixture(name: string): Record<string, any> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, name), 'utf-8'))
  fixture.variables.client_cert_pem.value = TLS_LAB_CLIENT_CERT_PEM
  fixture.variables.client_key_pem.value = TLS_LAB_CLIENT_KEY_PEM
  fixture.variables.ca_pem.value = CA_CERT_PEM
  return fixture
}

async function setConsoleDebug(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .click()
  }
  await page.locator('button[aria-label="Minimum log level"]').click()
  await page.getByRole('option', { name: 'DEBUG' }).click()
}

test.describe('HTTP mutual TLS client identity (real wire)', () => {
  test('mTLS across versions binds the client DN and masks the client key', async ({ page }) => {
    const fixture = loadFixture('fixture-mtls.json')
    const canary = keyCanary(TLS_LAB_CLIENT_KEY_PEM)

    await importValidateAndNavigate(page, fixture, { injectHttp: true })
    await setConsoleDebug(page)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    const logs = await waitForLogText(page, 'http-tls-mtls-done')
    const all = logs.join('\n')
    const status = await statusIndicator.getAttribute('data-status')
    if (status !== 'passed') {
      console.log('=== mTLS FAILED ===')
      console.log(all)
    }
    expect(status).toBe('passed')

    // The INFO Log line itself starts with the marker; its DEBUG Inputs / Outputs echoes do not.
    const line = (marker: string) => logs.find((t) => t.startsWith(marker)) ?? ''

    // ---- PERM-1: TLS 1.2, verified client DN reaches the listener ----
    await test.step('PERM-1: TLS 1.2 mTLS binds the client DN (server fact)', () => {
      expect(line('m1 status='), all).toContain('m1 status=200')
      expect(line('m1 status='), all).toContain('"listener":"mtls"')
      expect(line('m1 status='), all).toContain('"ssl_protocol":"TLSv1.2"')
      expect(line('m1 status='), all).toContain(CLIENT_CN)
    })

    // ---- PERM-2: pinning max 1.3 with a client cert negotiates TLS 1.3 ----
    // We never compress our own certificate, so the server accepts a plain Certificate
    // and mutual TLS carries data at 1.3 (the listener echoes the negotiated TLSv1.3).
    await test.step('PERM-2: mTLS pinned max 1.3 negotiates 1.3', () => {
      expect(line('m2 status='), all).toContain('m2 status=200')
      expect(line('m2 status='), all).toContain('"ssl_protocol":"TLSv1.3"')
      expect(line('m2 status='), all).toContain(CLIENT_CN)
    })

    // ---- PERM-3: pinned 1.0 and 1.1 client auth negotiate ----
    await test.step('PERM-3: mTLS at pinned 1.0 and 1.1', () => {
      expect(line('m3a status='), all).toContain('"ssl_protocol":"TLSv1"')
      expect(line('m3a status='), all).toContain(CLIENT_CN)
      expect(line('m3b status='), all).toContain('"ssl_protocol":"TLSv1.1"')
      expect(line('m3b status='), all).toContain(CLIENT_CN)
    })

    // ---- connect entries render the mTLS protocol + IANA cipher ----
    await test.step('connect entry renders "TLS TLSv1.X, cipher TLS_..." (UI fact)', async () => {
      const copy = await getLogCopyTexts(page)
      const dump = copy.join('\n@@\n')
      // The connect entry uses IANA cipher names at every version: PERM-1 is a TLSv1.2
      // hop, PERM-2 a TLSv1.3 hop - both render as "TLS TLSv1.X, cipher TLS_...".
      expect(copy.some((t) => /TLS TLSv1\.2, cipher TLS_/.test(t)), dump).toBeTruthy()
      expect(copy.some((t) => /TLS TLSv1\.3, cipher TLS_/.test(t)), dump).toBeTruthy()
    })

    // ---- client key masks everywhere ----
    await test.step('the client key masks in the DEBUG Inputs echo and never leaks', async () => {
      const copy = await getLogCopyTexts(page)
      const both = [...logs, ...copy].join('\n')
      // The masked Inputs echo shows the secret param as ********.
      expect(
        logs.some((t) => t.startsWith('Inputs:') && t.includes('"client_key":"********"')),
        `expected a masked client_key in a DEBUG Inputs line.\n${all}`,
      ).toBeTruthy()
      // The raw key body never renders anywhere in the console.
      expect(both, 'the raw client key must never render in cleartext').not.toContain(canary)
    })

    // ---- missing client identity to 9451 is rejected in the handshake ----
    await test.step('missing client identity is rejected by the mTLS listener (400)', () => {
      // nginx `ssl_verify_client on` completes the handshake and rejects a request that
      // carries no client cert with HTTP 400 ("No required SSL certificate was sent").
      expect(
        logs.some((t) => t.includes('noident status=400')),
        `expected the mTLS listener to reject the no-cert request with 400.\n${all}`,
      ).toBeTruthy()
    })

    // ---- node statuses ----
    await test.step('node statuses: every mTLS node succeeds (incl. the 400 no-cert reject)', async () => {
      for (const id of ['http-m1', 'http-m2', 'http-m3a', 'http-m3b', 'http-noident']) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success',
        )
      }
    })
  })
})
