/**
 * V-PLUGIN-K8S-CONNECT-FUNCTIONAL: K8s Connect against a real Kubernetes API.
 *
 * Five runs against the real-service kwok clusters (tests/e2e/services/kwok/):
 *
 *   credential matrix -> one workflow chains six Connect legs: admin bearer
 *     token with CA verification ON, client-certificate pair, token + cert
 *     together, the view-only token, anonymous (no credential - /version is
 *     readable by default), and acquire_run_token for service account
 *     wave-tests. Every leg reads v1.33; the same run doubles as the secret
 *     canary: the admin token appears nowhere in cleartext (console, WS,
 *     report, store) and the default-secret session output masks.
 *   run-token denial -> acquire_run_token under the view-only token fails
 *     with the plugin's real error, caught by a Try/Catch: the workflow
 *     PASSES, the bound error map carries the message, the node is not
 *     success.
 *   tunneled cluster -> SSH session + tunnel (local_port 0) reach the
 *     unpublished kwok-internal cluster; Connect pins tls_server_name and
 *     verifies the CA through the tunnel.
 *   session reveal -> Connects saved with the session output deliberately
 *     unchecked (stored outputSecretFields: []) surface the kubeconfig JSON
 *     in cleartext; the effective cipher_suites list is a non-empty array
 *     that narrows under a pinned 1.3-only range, and the token INSIDE the
 *     revealed session stays scrubbed (byte-form registration).
 *   token editor guard -> typing the token in the value editor and pressing
 *     Escape raises the Unsaved-changes dialog; Keep Editing preserves the
 *     draft, dialog-Save commits it, and the committed token rides into the
 *     run's emitted session.
 *
 * Design Decisions: K8SCON-1..K8SCON-6
 * REQ: REQ-5.1.1, REQ-3.4.1.5, REQ-4.5.1, REQ-4.6.3
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { getLogLines, waitForLogText } from '../../helpers/log-reader'
import {
  importValidateAndNavigate,
  injectServiceHost,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { configSheet, openBlockSheet, selectEnvironment } from '../../helpers/workbench'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { expectNoSecret, sweepStore, SECRET_MASK } from '../../helpers/secret-canary'
import {
  BACKEND_URL,
  K8S_ADMIN_TOKEN,
  K8S_LIMITED_TOKEN,
  K8S_CA_PEM,
  K8S_CLIENT_CERT_PEM,
  K8S_CLIENT_KEY_PEM,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

/** kwok is pinned to Kubernetes 1.33 - every version read starts with this. */
const K8S_VERSION_PREFIX = 'v1.33'

/** Load a fixture and inject the checked-in TEST-ONLY kwok material into its
 *  variables (never committed inside fixture JSON). */
function loadFixture(name: string): Record<string, any> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, name), 'utf-8'))
  const material: Record<string, string> = {
    k8s_admin_token: K8S_ADMIN_TOKEN,
    k8s_limited_token: K8S_LIMITED_TOKEN,
    k8s_client_cert: K8S_CLIENT_CERT_PEM,
    k8s_client_key: K8S_CLIENT_KEY_PEM,
    k8s_ca: K8S_CA_PEM,
  }
  for (const [varName, value] of Object.entries(material)) {
    if (fixture.variables[varName]) fixture.variables[varName].value = value
  }
  return fixture
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

/** Select the environment, click Run, and wait for the run to leave idle. */
async function startRun(page: Page): Promise<Locator> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  return status
}

/** Wait for the terminal state + the bookend marker, dump on failure, and
 *  assert the run passed. Returns the harvested console log texts. */
async function finishRun(
  page: Page,
  status: Locator,
  marker: string,
  runTimeout = 120_000,
): Promise<string[]> {
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: runTimeout })
  const logs = await waitForLogText(page, marker, 30_000)
  const statusVal = await status.getAttribute('data-status')
  if (statusVal !== 'passed') {
    console.log('=== K8S CONNECT WORKFLOW FAILED ===')
    console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
    console.log('logs:', logs.join('\n'))
  }
  expect(statusVal).toBe('passed')
  return logs
}

async function expectNodesSuccess(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
      'data-execution-status',
      'success',
    )
  }
}

test.describe('K8s Connect E2E (real kwok cluster)', () => {
  test('credential matrix connects on every leg and the admin token never leaks', async ({
    page,
  }) => {
    const fixture = loadFixture('fixture-matrix.json')
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    // The leading Delay node holds the run while we grab the session id and
    // subscribe (there is no event replay for late WS subscribers).
    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    const logs = await finishRun(page, status, 'k8s-matrix-e2e-done')
    const all = logs.join('\n')
    const line = (prefix: string) => logs.find((t) => t.startsWith(prefix)) ?? ''
    const present = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    await test.step('every credential leg reads the real cluster version', () => {
      for (const leg of ['admin', 'cert', 'both', 'limited', 'anon', 'runtoken']) {
        expect(
          line(`k8sconn-${leg} `),
          `leg "${leg}" did not read the cluster version.\n${all}`,
        ).toContain(`ver=${K8S_VERSION_PREFIX}`)
      }
      present(`Connected to Kubernetes ${K8S_VERSION_PREFIX}`)
    })

    await test.step('the run token for wave-tests is granted', () => {
      present("Run token for service account 'wave-tests' granted until")
    })

    await test.step('every node succeeds', async () => {
      await expectNodesSuccess(page, [
        'delay-hold',
        'connect-admin', 'log-admin',
        'connect-cert', 'log-cert',
        'connect-both', 'log-both',
        'connect-limited', 'log-limited',
        'connect-anon', 'log-anon',
        'connect-runtoken', 'log-runtoken',
        'log-done',
      ])
    })

    await test.step('canary: the admin token appears nowhere in cleartext', async () => {
      expectNoSecret(all, 'console log', [K8S_ADMIN_TOKEN])

      const events = await collector.harvest()
      await collector.close()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
      expectNoSecret(JSON.stringify(events), 'WS stream', [K8S_ADMIN_TOKEN])

      const variables = await getSessionVariables(page, sessionId)
      expect(
        variables.sess_admin.value,
        'the default-secret session output must mask in the variables API',
      ).toBe(SECRET_MASK)
      expectNoSecret(JSON.stringify(variables), 'session variables', [K8S_ADMIN_TOKEN])

      const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(genResp.status(), await genResp.text()).toBe(200)
      const contentResp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
      )
      expect(contentResp.ok()).toBeTruthy()
      const report = await contentResp.text()
      expect(report, 'the report must carry the real run').toContain('k8sconn-admin')
      expectNoSecret(report, 'report', [K8S_ADMIN_TOKEN])

      expect(sweepStore(K8S_ADMIN_TOKEN), 'admin token found in the store').toEqual([])
    })
  })

  test('a run-token request under the view-only token is denied and caught', async ({ page }) => {
    const fixture = loadFixture('fixture-denied.json')
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    const status = await startRun(page)
    const logs = await finishRun(page, status, 'k8s-denied-e2e-done', 90_000)
    const all = logs.join('\n')

    await test.step('the denial surfaces with the plugin\'s real error', async () => {
      expect(
        logs.some((t) => t.includes('k8s-denied-caught run-token-refused')),
        `the catch branch must have run.\n${all}`,
      ).toBeTruthy()
      const boundLine = logs.find((t) => t.includes('k8s-denied-err')) ?? ''
      // The whole error map is logged via repr, which escapes the quotes
      // around the SA name, so the message is matched in quote-free pieces.
      expect(
        boundLine,
        `the bound error output must carry the plugin's real error.\n${boundLine}`,
      ).toContain('Could not get a run token for service account')
      expect(boundLine).toContain('wave-tests')
      expect(boundLine).toContain('403')
      const logEntries = await getLogLines(page)
      expect(
        logEntries.some((e) => e.includes('Try-path error caught')),
        'Engine should log that the denial was caught',
      ).toBeTruthy()
    })

    await test.step('the guarded Connect node did not succeed; the rest did', async () => {
      await expectNodesSuccess(page, ['tc-denied', 'log-caught', 'log-err', 'log-done'])
      expect(
        await page
          .locator('[data-testid="workflow-node-connect-denied"]')
          .getAttribute('data-execution-status'),
        'the denied Connect must not succeed',
      ).not.toBe('success')
    })
  })

  test('K8s Connect reaches the unpublished cluster through an SSH tunnel', async ({ page }) => {
    const fixture = injectServiceHost(loadFixture('fixture-tunnel.json'))
    await importValidateAndNavigate(page, fixture)

    const status = await startRun(page)
    const logs = await finishRun(page, status, 'k8s-tunnel-e2e-done', 90_000)
    const all = logs.join('\n')

    await test.step('the tunneled Connect reads the real cluster version', () => {
      const tunnelLine = logs.find((t) => t.startsWith('k8stunnel ')) ?? ''
      expect(tunnelLine, `tunneled version read missing.\n${all}`).toContain(
        `ver=${K8S_VERSION_PREFIX}`,
      )
      expect(
        logs.some((t) => t.includes(`Connected to Kubernetes ${K8S_VERSION_PREFIX}`)),
        `plugin connect line missing.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('every node succeeds', async () => {
      await expectNodesSuccess(page, [
        'open-session', 'tunnel-open', 'connect-tunnel', 'log-tunnel',
        'tunnel-close', 'close-session', 'log-done',
      ])
    })
  })

  test('a deliberately revealed session is cleartext with a narrowing cipher list', async ({
    page,
  }) => {
    const fixture = loadFixture('fixture-reveal.json')
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const logs = await finishRun(page, status, 'k8s-reveal-e2e-done', 90_000)
    const all = logs.join('\n')

    for (const prefix of ['k8sreveal-def ', 'k8sreveal-narrow ']) {
      expect(logs.find((t) => t.startsWith(prefix)) ?? '', all).toContain(
        `ver=${K8S_VERSION_PREFIX}`,
      )
    }
    await expectNodesSuccess(page, [
      'connect-default', 'log-def', 'connect-narrow', 'log-narrow', 'log-done',
    ])

    const variables = await getSessionVariables(page, sessionId)
    const defRaw = String(variables.sess_def.value)
    const narrowRaw = String(variables.sess_narrow.value)

    await test.step('the unchecked session output reads back as cleartext JSON', () => {
      for (const [name, raw] of [['sess_def', defRaw], ['sess_narrow', narrowRaw]] as const) {
        expect(variables[name].type, `${name} must stay a string`).toBe('string')
        expect(raw, `${name} must not collapse to the mask`).not.toBe(SECRET_MASK)
        // Prove the reveal on a NON-token fragment: the kubeconfig structure.
        expect(raw, `${name} must surface the kubeconfig structure`).toContain('"server"')
      }
    })

    await test.step('the effective cipher list is explicit and narrows with the TLS range', () => {
      const suitesOf = (raw: string) =>
        JSON.parse(raw).clusters[0].cluster.extensions[0].extension.cipher_suites
      const defSuites = suitesOf(defRaw)
      const narrowSuites = suitesOf(narrowRaw)
      expect(Array.isArray(defSuites), 'default-range cipher_suites must be an array').toBeTruthy()
      expect(defSuites.length, 'default-range cipher list must not be empty').toBeGreaterThan(0)
      expect(Array.isArray(narrowSuites), '1.3-only cipher_suites must be an array').toBeTruthy()
      expect(narrowSuites.length, '1.3-only cipher list must not be empty').toBeGreaterThan(0)
      expect(
        narrowSuites.length,
        'pinning the range to 1.3 must narrow the effective cipher list',
      ).toBeLessThan(defSuites.length)
    })

    await test.step('the token inside the revealed session stays scrubbed', () => {
      // The secret token input registers its byte-form, so even a revealed
      // session scrubs it on every read surface - the reveal is structural.
      expect(JSON.stringify(variables), 'the raw token must never read back').not.toContain(
        K8S_ADMIN_TOKEN,
      )
      const parsed = JSON.parse(defRaw)
      expect(parsed.users[0].user.token, 'the carried token must be scrubbed').toBe(SECRET_MASK)
      expectNoSecret(all, 'console log', [K8S_ADMIN_TOKEN])
    })
  })

  test('the value-editor guard protects the typed token and it rides into the run', async ({
    page,
  }) => {
    const fixture = loadFixture('fixture-editor.json')
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    const node = page.locator('[data-testid="workflow-node-connect-editor"]')
    await node.hover()
    await openBlockSheet(page, 'connect-editor')
    const sheet = configSheet(page)
    await expect(sheet).toBeVisible()

    const editor = page.locator('[data-testid="value-editor-sheet"]')
    const guard = page.locator('[data-testid="value-editor-unsaved-dialog"]')
    const cm = editor.locator('.cm-content')

    await test.step('a dirty draft dismissed with Escape raises the guard dialog', async () => {
      await sheet.locator('[data-testid="param-row-token"]').scrollIntoViewIfNeeded()
      await sheet.locator('[data-testid="param-expand-token"]').click()
      await expect(editor).toBeVisible()
      await cm.click()
      await page.keyboard.press('Control+a')
      await page.keyboard.type(K8S_ADMIN_TOKEN)
      await page.keyboard.press('Escape')
      await expect(guard).toBeVisible()
    })

    await test.step('Keep Editing preserves the typed draft', async () => {
      await guard.locator('[data-testid="value-editor-unsaved-keep-button"]').click()
      await expect(guard).not.toBeVisible()
      await expect(editor).toBeVisible()
      await expect(cm).toContainText(K8S_ADMIN_TOKEN)
    })

    await test.step('dialog Save commits the draft to the row', async () => {
      await page.keyboard.press('Escape')
      await expect(guard).toBeVisible()
      await guard.locator('[data-testid="value-editor-unsaved-save-button"]').click()
      await expect(editor).not.toBeVisible()
      await expect(sheet.locator('[data-testid="param-row-token"] [data-slot="input-group"] input')).toHaveValue(
        K8S_ADMIN_TOKEN,
      )
    })

    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).not.toBeVisible()

    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const logs = await finishRun(page, status, 'k8s-editor-e2e-done', 90_000)
    const all = logs.join('\n')

    await test.step('the committed token authenticated and rode into the session', async () => {
      expect(
        logs.some((t) => t.includes(`Connected to Kubernetes ${K8S_VERSION_PREFIX}`)),
        `plugin connect line missing.\n${all}`,
      ).toBeTruthy()
      expect(logs.find((t) => t.startsWith('k8seditor ')) ?? '', all).toContain(
        `ver=${K8S_VERSION_PREFIX}`,
      )
      await expectNodesSuccess(page, ['connect-editor', 'log-editor', 'log-done'])

      // The session output is deliberately revealed, so the kubeconfig reads
      // back cleartext and its users entry carries the committed token - as a
      // secret param the typed literal registers its byte-form, so the token
      // itself scrubs on every read surface. An uncommitted (discarded) draft
      // would have produced a session with NO token entry at all.
      const variables = await getSessionVariables(page, sessionId)
      const raw = String(variables.sess_i.value)
      expect(raw, 'the revealed session must not collapse to the mask').not.toBe(SECRET_MASK)
      expect(raw, 'the revealed session must surface the kubeconfig structure').toContain(
        '"server"',
      )
      const parsed = JSON.parse(raw)
      expect(
        parsed.users[0].user.token,
        'the session must carry the committed token (scrubbed on read)',
      ).toBe(SECRET_MASK)
      expect(JSON.stringify(variables), 'the raw token must never read back').not.toContain(
        K8S_ADMIN_TOKEN,
      )
      expectNoSecret(all, 'console log', [K8S_ADMIN_TOKEN])
    })
  })
})
