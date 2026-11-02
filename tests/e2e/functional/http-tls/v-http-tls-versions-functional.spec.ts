/**
 * V-HTTP-TLS-VERSIONS-FUNCTIONAL: TLS protocol-version pins on the real wire.
 *
 * Runs the HTTP plugin locally on WAVE against the tls-lab nginx matrix
 * (tests/e2e/services/tls-lab). Every listener echoes the negotiated protocol
 * and cipher as JSON, giving a server-received fact; the DEBUG connect trace
 * (data-copy-text) gives the UI-side fact. Together they prove:
 *   - PERM-6: min=max=X against the X-only listener negotiates X (1.0-1.3).
 *   - the connect entry renders "TLS TLSv1.X, cipher TLS_..." (IANA).
 *   - Requests run over HTTP/1.1 (a 200 from an HTTP/1.1-only
 *     nginx listener is the server-side proof); a stored `http2` key is no
 *     setting of the Block and is refused at save (HTTP-13).
 *   - PERM-7: pin max 1.2 against the 1.3-only listener fails the handshake
 *     (caught), and no request reaches the server (bound status stays 0).
 * A second test proves that a stored inverted min/max + an unknown cipher is
 * rejected before any byte leaves WAVE, with the exact runtime-guard messages.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/http-tls/v-http-tls-versions-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts, waitForLogText } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { createTestViaAdminBulk } from '../import-export/helpers'
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

async function runToTerminal(page: Page): Promise<string | null> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
  return status.getAttribute('data-status')
}

test.describe('HTTP TLS version pins (real wire)', () => {
  test('version pins negotiate on the wire; HTTP/1.1 only; mismatch caught', async ({
    page,
  }) => {
    const fixture = loadFixture('fixture-versions.json')
    await importValidateAndNavigate(page, fixture, { injectHttp: true })
    await setConsoleDebug(page)

    const status = await runToTerminal(page)
    const logs = await waitForLogText(page, 'http-tls-versions-done')
    const all = logs.join('\n')
    if (status !== 'passed') {
      const nodeStatuses = await page.evaluate(() => {
        const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
        return Array.from(nodes).map((n) => ({
          id: n.getAttribute('data-testid'),
          status: n.getAttribute('data-execution-status'),
        }))
      })
      console.log('=== TLS VERSIONS FAILED ===')
      console.log(JSON.stringify(nodeStatuses, null, 2))
      console.log(all)
    }
    expect(status).toBe('passed')

    // ---- PERM-6: server-received protocol per X-only listener ----
    await test.step('PERM-6: each listener reports the pinned protocol (server fact)', () => {
      // The trailing quote pins the exact value (TLSv1 is a prefix of TLSv1.1).
      // The INFO Log line itself starts with the marker; its DEBUG Inputs / Outputs echoes do not.
      const line = (marker: string) => logs.find((t) => t.startsWith(marker)) ?? ''
      expect(line('v10 status='), all).toContain('"listener":"tls10"')
      expect(line('v10 status='), all).toContain('"ssl_protocol":"TLSv1"')
      expect(line('v11 status='), all).toContain('"listener":"tls11"')
      expect(line('v11 status='), all).toContain('"ssl_protocol":"TLSv1.1"')
      expect(line('v12 status='), all).toContain('"listener":"tls12"')
      expect(line('v12 status='), all).toContain('"ssl_protocol":"TLSv1.2"')
      expect(line('v13 status='), all).toContain('"listener":"tls13"')
      expect(line('v13 status='), all).toContain('"ssl_protocol":"TLSv1.3"')
    })

    // ---- connect trace shows the negotiated protocol + IANA cipher ----
    await test.step('DEBUG connect entry renders "TLS TLSv1.X, cipher TLS_..." (UI fact)', async () => {
      const copy = await getLogCopyTexts(page)
      const dump = copy.join('\n@@\n')
      // The comma right after the version disambiguates TLSv1 from TLSv1.1.
      expect(copy.some((t) => /TLS TLSv1, cipher TLS_/.test(t)), dump).toBeTruthy()
      expect(copy.some((t) => /TLS TLSv1\.1, cipher TLS_/.test(t)), dump).toBeTruthy()
      expect(copy.some((t) => /TLS TLSv1\.2, cipher TLS_/.test(t)), dump).toBeTruthy()
      expect(copy.some((t) => /TLS TLSv1\.3, cipher TLS_/.test(t)), dump).toBeTruthy()
    })

    // ---- HTTP-13: the request runs HTTP/1.1 (200 from an HTTP/1.1 listener) ----
    await test.step('HTTP-13: the request runs HTTP/1.1 (server 200)', () => {
      const h2 = logs.find((t) => t.startsWith('h2 status=')) ?? ''
      expect(h2, all).toContain('h2 status=200')
      // nginx `listen ssl` (no http2 directive) speaks only HTTP/1.1: a 200 is the proof.
      expect(h2, all).toContain('"listener":"tls12"')
    })

    // ---- PERM-7: version mismatch fails the handshake before any request ----
    await test.step('PERM-7: max 1.2 vs the 1.3-only listener fails; server saw nothing', () => {
      // The try-catch surfaces the caught error as a WARN "Try-path error caught: <msg>".
      expect(
        logs.some((t) => t.includes('Try-path error caught:') && t.includes('TLS handshake failed:')),
        `expected a caught handshake failure.\n${all}`,
      ).toBeTruthy()
      // The catch branch ran and the bound status never advanced past its default.
      expect(
        logs.some((t) => t.includes('ver-mismatch-caught') && t.includes('status=0')),
        `expected the catch path with status=0 (no request reached the server).\n${all}`,
      ).toBeTruthy()
    })

    // ---- node statuses ----
    await test.step('node statuses: successes green, the mismatch try-node failed', async () => {
      for (const id of ['http-v10', 'http-v11', 'http-v12', 'http-v13', 'http-h2']) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'data-execution-status',
          'success',
        )
      }
      await expect(page.locator('[data-testid="workflow-node-http-mismatch"]')).toHaveAttribute(
        'data-execution-status',
        'failed',
      )
    })
  })

  // The identical message the runtime pre-send guard raises is enforced at
  // save/run-validate, so a stored inverted pin + unknown cipher is refused before
  // any byte leaves WAVE (the server can never be reached).
  test('stored inverted min/max + unknown cipher are rejected pre-send', async ({
    page,
  }) => {
    await ensureEnvironment(page.request)
    const seeded = {
      id: randomUUID(),
      name: `TLS Seed Reject ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: '1.0.0',
      description: '',
      workflow: {
        nodes: [
          {
            id: 'http-bad',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: {
              label: 'HTTP',
              elementType: 'http-client',
              nodeType: 'plugin',
              category: 'network',
              version: '1.0.0',
              description: 'Inverted pins + unknown cipher',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              config: {
                values: {
                  url: 'https://127.0.0.1:9454/',
                  method: 'GET',
                  timeout: 30,
                  verify_ssl: false,
                  allow_redirects: true,
                  max_redirects: 10,
                  tls_min_version: '1.3',
                  tls_max_version: '1.0',
                  cipher_suites: ['NO-SUCH-CIPHER-SUITE'],
                },
                outputBindings: {},
                profileBindings: [],
              },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [{ id: 'e-start', source: 'start-node', target: 'http-bad', type: 'default' }],
      },
      variables: {},
      metadata: { tags: [], suite_id: null, parent_suite: null },
    }

    // Save validation would reject this config at POST /tests; bulk-seed bypasses it so
    // the runtime/validate pre-send guard is what we exercise.
    const testId = await createTestViaAdminBulk(page, seeded)

    try {
      const validateResp = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate?context=run`)
      const validateBody = await validateResp.json().catch(() => null)
      const errors: Array<{ code?: string; message?: string; node_id?: string }> =
        validateBody?.data?.errors ??
        validateBody?.error?.details?.[0]?.errors ??
        validateBody?.errors ??
        []
      const dump = JSON.stringify(errors)
      expect(
        errors.some((e) => e.message === 'Min TLS Version cannot exceed Max TLS Version'),
        `expected the inverted-order message. Got:\n${dump}`,
      ).toBeTruthy()
      expect(
        errors.some((e) => e.message === 'Unknown cipher suite "NO-SUCH-CIPHER-SUITE"'),
        `expected the unknown-cipher message. Got:\n${dump}`,
      ).toBeTruthy()
      expect(errors.some((e) => e.node_id === 'http-bad')).toBeTruthy()
    } finally {
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    }
  })

  // HTTP-13: there is no HTTP/2, so a stored http2 key is a setting the Block does not have.
  test('HTTP-13: a stored http2 key is refused at save', async ({ page }) => {
    await ensureEnvironment(page.request)
    const fixture = loadFixture('fixture-versions.json')
    const h2 = structuredClone(fixture.workflow.nodes.find((node: { id: string }) => node.id === 'http-h2'))
    h2.data.config.values.http2 = true
    const name = `zz-11541-s10-tls-http2-refused-${randomUUID().slice(0, 8)}`
    const response = await page.request.post(`${BACKEND_URL}/tests`, {
      data: { ...fixture, name, workflow: { nodes: [h2], edges: [] } },
    })
    const body = await response.json().catch(() => null)
    expect(response.status(), JSON.stringify(body)).toBe(422)
    const details = (body?.error?.details ?? []) as Array<{ code?: string; message?: string; node_id?: string }>
    expect(
      details.map((entry) => [entry.code, entry.message, entry.node_id]),
      JSON.stringify(details),
    ).toEqual([['UNKNOWN_SETTING', "Block 'http-client' has no setting 'http2'", 'http-h2']])
    const listed = await page.request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`)
    expect((await listed.json()).data ?? [], 'nothing is stored').toHaveLength(0)
  })
})
