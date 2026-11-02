/**
 * V-PLUGIN-SSH-SECRETS-FUNCTIONAL: SSH secret masking + declared-credential sealing.
 *
 * REQ: REQ-3.1.3.5 / REQ-3.1.3.16 / REQ-3.1.3.18 / REQ-4.5.1.
 *
 * The full leak sweep for the SSH Session plugins. A declared credential LITERAL
 * (the password) seals to a wave:enc:v1: envelope at rest and still authenticates
 * against the real OpenSSH host (unsealed at run); a passphrase LITERAL seals at
 * rest; and secret-variable carriers for all three credential categories
 * (password / private_key / passphrase) mask everywhere the run touches. Nothing
 * appears in cleartext across on-disk storage, the console, the DEBUG harness I/O
 * lines, the WS stream, the report, or the mask / encrypted exports. A second
 * import-only test proves all three declared credential fields seal at rest.
 *
 * Secrets crossing into a REMOTE request are covered by remote-exec/ (api_token).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, waitForLogText } from '../../helpers/log-reader'
import {
  importFixtureTest,
  importValidateAndNavigate,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { BACKEND_URL, STORAGE_BASE_PATH, ensureEnvironment } from '../../helpers/config'
import {
  expectNoSecret,
  sweepStore,
  dirBytes,
  SECRET_MASK,
  SECRET_ENVELOPE,
} from '../../helpers/secret-canary'
import fs from 'fs'
import path from 'path'

const MASK = SECRET_MASK
const ENVELOPE = SECRET_ENVELOPE

// Planted secrets in the main run fixture: the password literal (also the real
// auth secret), the passphrase literal, and the three secret-variable carriers.
const PASSWORD_LITERAL = 'wave-secret'
const PASSPHRASE_LITERAL = 'phrase-lit-canary-7a1b2c'
const RUN_SECRETS = [
  PASSWORD_LITERAL,
  'key-var-canary-8d2e3f',
  'phrase-var-canary-9e4f5a',
  PASSPHRASE_LITERAL,
]
const PLAIN = 'ssh-plain-visible-0000'

// The three declared credential literals in the import-only sealing fixture.
const SEAL_SECRETS = ['pw-seal-canary-1a2b3c', 'pk-seal-canary-4d5e6f', 'ph-seal-canary-7g8h9i']

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
}

function debugMessages(events: Array<Record<string, unknown>>): string[] {
  return events
    .map((event) => event.message)
    .filter((message): message is string => typeof message === 'string')
}

function testDirBytes(testId: string): Buffer {
  return dirBytes(path.join(STORAGE_BASE_PATH, 'api_tests', testId))
}

test.describe('V-PLUGIN-SSH-SECRETS-FUNCTIONAL', () => {
  test('declared-cred literal seals + authenticates, nothing leaks on any surface', async ({
    page,
  }: {
    page: Page
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    const testId = await importValidateAndNavigate(page, loadFixture('fixture.json'), {
      injectSsh: true,
    })

    await test.step('sealed on disk: password/passphrase literals are envelopes, plain sibling cleartext', async () => {
      const bytes = testDirBytes(testId)
      expect(bytes.includes(ENVELOPE), 'a declared credential literal must seal at rest').toBeTruthy()
      expect(bytes.includes(PASSWORD_LITERAL), 'the password literal must not sit cleartext').toBeFalsy()
      expect(
        bytes.includes(PASSPHRASE_LITERAL),
        'the passphrase literal must not sit cleartext',
      ).toBeFalsy()
      expect(bytes.includes(PLAIN), 'the non-secret sibling variable must stay cleartext').toBeTruthy()
    })

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    await test.step('run passes: the sealed literal password authenticated (unsealed at run)', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
      const logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')
      expect(await status.getAttribute('data-status'), `run failed.\n${all}`).toBe('passed')
      expect(all.includes('Permission denied'), `the sealed password must authenticate.\n${all}`).toBeFalsy()
    })

    await test.step('console: every secret category masks, plain sibling cleartext, no leak', async () => {
      const logTexts = await waitForLogText(page, 'ssh-secrets-done')
      const all = logTexts.join('\n')
      expect(
        logTexts.some(
          (t) => t.includes(`pass=${MASK}`) && t.includes(`key=${MASK}`) && t.includes(`phrase=${MASK}`),
        ),
        `all three secret categories must mask in the audit line.\n${all}`,
      ).toBeTruthy()
      expect(logTexts.some((t) => t.includes(`plain=${PLAIN}`)), `plain sibling missing.\n${all}`).toBeTruthy()
      expect(logTexts.some((t) => t.includes('ssh-secrets-done')), `bookend missing.\n${all}`).toBeTruthy()
      expectNoSecret(all, 'console log', RUN_SECRETS)
    })

    await test.step('DEBUG Inputs echo masks the declared credential', async () => {
      const messages = debugMessages(await collector.harvest())
      // The SSH Open block's masked Inputs echo broadcasts at DEBUG; the declared
      // password (unsealed to its real bytes at run) is masked there, username is not.
      const inputsLine = messages.find(
        (m) => m.startsWith('Inputs:') && m.includes('"username":"wave"'),
      )
      expect(
        inputsLine,
        `a masked Inputs line for the SSH block must broadcast at DEBUG. Got:\n${messages.join('\n')}`,
      ).toBeTruthy()
      expect(inputsLine!, 'the declared credential must be masked in the Inputs echo').toContain(MASK)
      expectNoSecret(inputsLine!, 'SSH Inputs line', RUN_SECRETS)
    })

    await test.step('WS + session variables + report masked, no leak', async () => {
      const events = await collector.harvest()
      expectNoSecret(JSON.stringify(events), 'WS stream', RUN_SECRETS)
      const variables = await getSessionVariables(page, sessionId)
      expectNoSecret(JSON.stringify(variables), 'session variables', RUN_SECRETS)
      await collector.close()

      const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(genResp.status(), await genResp.text()).toBe(200)
      const contentResp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
      )
      expect(contentResp.ok()).toBeTruthy()
      expectNoSecret(await contentResp.text(), 'report', RUN_SECRETS)
    })

    await test.step('disk sweep clean post-run', async () => {
      for (const needle of RUN_SECRETS) {
        expect(sweepStore(needle), `secret ${needle} persisted by the run`).toEqual([])
      }
    })

    await test.step('exports keep the credential sealed/masked, never cleartext', async () => {
      for (const mode of ['mask', 'encrypted'] as const) {
        const resp = await page.request.post(`${BACKEND_URL}/tests/export`, {
          data: { test_ids: [testId], format: 'json', secrets: mode },
        })
        expect(resp.ok(), `test export (${mode}) failed: ${resp.status()}`).toBeTruthy()
        const text = await resp.text()
        expect(text, `export (${mode}) must carry the safe form`).toContain(
          mode === 'mask' ? MASK : ENVELOPE,
        )
        expectNoSecret(text, `test export (${mode})`, RUN_SECRETS)
      }
    })

    await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  })

  test('all three declared credential fields seal at rest', async ({ page }: { page: Page }) => {
    test.setTimeout(120_000)
    await ensureEnvironment(page.request)
    const testId = await importFixtureTest(page, loadFixture('fixture-seal.json'))

    try {
      const bytes = testDirBytes(testId)
      expect(
        bytes.includes(ENVELOPE),
        'the SSH declared credential literals must seal to envelopes at rest',
      ).toBeTruthy()
      for (const needle of SEAL_SECRETS) {
        expect(
          bytes.includes(needle),
          `declared credential literal ${needle} must not sit cleartext at rest`,
        ).toBeFalsy()
      }
      for (const needle of SEAL_SECRETS) {
        expect(sweepStore(needle), `declared credential literal ${needle} leaked in the store`).toEqual([])
      }
    } finally {
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    }
  })
})
