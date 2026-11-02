/**
 * V-HTTP-TLS-CIPHERS-FUNCTIONAL: TLS cipher-suite selection on the real wire.
 *
 * Drives the HTTP plugin locally on WAVE against the tls-lab cipher listeners
 * (tests/e2e/services/tls-lab). Each listener echoes the negotiated OpenSSL
 * cipher name as JSON (server fact); the DEBUG connect trace shows the IANA
 * name (UI fact). Proves:
 *   - PERM-13: a single-suite pin matching the single-cipher listener (9456)
 *     negotiates it; a disjoint pin fails the handshake (caught).
 *   - PERM-14: against the client-preference listener (9457, prefer_server off),
 *     pin [256,128] -> negotiates 256, pin [128,256] -> negotiates 128.
 *   - PERM-15: a single TLS 1.3 AEAD pin vs the 1.3-only listener negotiates it.
 *   - PERM-16: an explicit-zero cipher list fails the handshake, and no
 *     request reaches the server (bound status stays 0).
 *   - FIELD-10: a list given by an expression carrying one out-of-range (1.3)
 *     suite drops it at run time and keeps the in-range subset in family order
 *     (the negotiated 1.2 suite is the first in-range entry, client preference wins).
 *   - every connect entry renders "cipher TLS_..." (IANA names).
 * A second test (HTTP-13, FIELD-10): a typed suite the TLS versions cannot offer
 * is refused at save with `TLS_CIPHER_OUT_OF_RANGE` and nothing is stored.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/http-tls/v-http-tls-ciphers-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts, waitForLogText } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

function loadFixture(name: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, name), 'utf-8'))
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

const A128 = 'ECDHE-RSA-AES128-GCM-SHA256'
const A256 = 'ECDHE-RSA-AES256-GCM-SHA384'
const T13 = 'TLS_AES_128_GCM_SHA256'

test.describe('HTTP TLS cipher pins (real wire)', () => {
  test('cipher pins select on the wire; reorder honors client preference; zero fails', async ({
    page,
  }) => {
    const fixture = loadFixture('fixture-ciphers.json')
    await importValidateAndNavigate(page, fixture, { injectHttp: true })
    await setConsoleDebug(page)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    const logs = await waitForLogText(page, 'http-tls-ciphers-done')
    const all = logs.join('\n')
    const status = await statusIndicator.getAttribute('data-status')
    if (status !== 'passed') {
      console.log('=== TLS CIPHERS FAILED ===')
      console.log(all)
    }
    expect(status).toBe('passed')

    // The INFO Log line itself starts with the marker; its DEBUG Inputs / Outputs echoes do not.
    const line = (marker: string) => logs.find((t) => t.startsWith(marker)) ?? ''

    // ---- PERM-13: single-suite pin negotiates it on the cipher-pin listener ----
    await test.step('PERM-13: single-suite pin negotiates the matching cipher', () => {
      expect(line('c1 status='), all).toContain('"listener":"cipher-pin"')
      expect(line('c1 status='), all).toContain(`"ssl_cipher":"${A256}"`)
    })

    // ---- PERM-14: client preference wins on the reorder listener ----
    await test.step('PERM-14: [256,128] -> 256, [128,256] -> 128 (client preference)', () => {
      expect(line('c2 status='), all).toContain('"listener":"cipher-reorder"')
      expect(line('c2 status='), all).toContain(`"ssl_cipher":"${A256}"`)
      expect(line('c3 status='), all).toContain(`"ssl_cipher":"${A128}"`)
    })

    // ---- PERM-15: a single TLS 1.3 AEAD pin negotiates it ----
    await test.step('PERM-15: single TLS 1.3 AEAD pin negotiates it on the 1.3 listener', () => {
      expect(line('c4 status='), all).toContain('"listener":"tls13"')
      expect(line('c4 status='), all).toContain(`"ssl_cipher":"${T13}"`)
    })

    // ---- out-of-range suite dropped, in-range subset kept in family order ----
    await test.step('out-of-range 1.3 suite dropped; first in-range 1.2 suite wins', () => {
      // The expression gives [128, <1.3 out-of-range>, 256] at max 1.2: the 1.3 suite is
      // dropped and 128 (first in-range) negotiates against the reorder listener.
      expect(line('c5 status='), all).toContain('"listener":"cipher-reorder"')
      expect(line('c5 status='), all).toContain(`"ssl_cipher":"${A128}"`)
    })

    // ---- connect entries render IANA cipher names ----
    await test.step('connect trace renders "cipher TLS_..." IANA names (UI fact)', async () => {
      const copy = await getLogCopyTexts(page)
      const dump = copy.join('\n@@\n')
      expect(
        copy.some((t) => /cipher TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384/.test(t)),
        dump,
      ).toBeTruthy()
      expect(
        copy.some((t) => /cipher TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256/.test(t)),
        dump,
      ).toBeTruthy()
      expect(copy.some((t) => /cipher TLS_AES_128_GCM_SHA256/.test(t)), dump).toBeTruthy()
    })

    // ---- PERM-13 negative: a disjoint pin fails the handshake ----
    await test.step('PERM-13 negative: disjoint pin fails the handshake (caught)', () => {
      // At least two caught handshake failures surface (disjoint + explicit-zero).
      expect(
        logs.filter((t) => t.includes('Try-path error caught:') && t.includes('TLS handshake failed:'))
          .length >= 2,
        `expected two caught handshake failures.\n${all}`,
      ).toBeTruthy()
      expect(
        logs.some((t) => t.includes('disjoint-caught') && t.includes('status=0')),
        `expected the disjoint catch path with status=0 (no request reached the server).\n${all}`,
      ).toBeTruthy()
    })

    // ---- PERM-16: an explicit-zero cipher list fails; server saw nothing ----
    await test.step('PERM-16: explicit-zero cipher list fails the handshake', () => {
      expect(
        logs.some((t) => t.includes('zero-caught') && t.includes('status=0')),
        `expected the explicit-zero catch path with status=0 (no request reached the server).\n${all}`,
      ).toBeTruthy()
    })

    // ---- node statuses ----
    await test.step('node statuses: pins green, disjoint + zero try-nodes failed', async () => {
      for (const id of ['http-c1', 'http-c2', 'http-c3', 'http-c4', 'http-c5']) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success',
        )
      }
      for (const id of ['http-disjoint', 'http-zero']) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'failed',
        )
      }
    })
  })

  // HTTP-13 / FIELD-10: a typed name is checked against the TLS versions when the Test is saved.
  test('a typed suite the TLS versions cannot offer is refused at save', async ({ page }) => {
    await ensureEnvironment(page.request)
    const fixture = loadFixture('fixture-ciphers.json')
    const typed = structuredClone(fixture.workflow.nodes.find((node: { id: string }) => node.id === 'http-c5'))
    typed.data.expressionFields = []
    typed.data.config.values.cipher_suites = [A128, 'TLS_AES_256_GCM_SHA384', A256]
    const name = `zz-11541-s10-tls-cipher-refused-${randomUUID().slice(0, 8)}`
    const response = await page.request.post(`${BACKEND_URL}/tests`, {
      data: { ...fixture, name, workflow: { nodes: [typed], edges: [] } },
    })
    const body = await response.json().catch(() => null)
    expect(response.status(), JSON.stringify(body)).toBe(422)
    const details = (body?.error?.details ?? []) as Array<{ code?: string; message?: string; node_id?: string }>
    expect(
      details.map((entry) => [entry.code, entry.message, entry.node_id]),
      JSON.stringify(details),
    ).toEqual([
      ['TLS_CIPHER_OUT_OF_RANGE', 'Cipher suite "TLS_AES_256_GCM_SHA384" is not available in TLS 1.2 to 1.2', 'http-c5'],
    ])
    const listed = await page.request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`)
    expect((await listed.json()).data ?? [], 'nothing is stored').toHaveLength(0)
  })
})
