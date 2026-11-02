/**
 * V-SECRET-NEW-CARRIERS-FUNCTIONAL: the two secret carriers end-to-end.
 *
 * REQ: REQ-3.1.3.5 (output-bound secret masking, setter node-config seal),
 *      REQ-4.5.1 (setter secret literal sealed at rest)
 *
 * Carrier S: a Variable Setter row marked secret writes a literal.
 *   The literal is sealed on disk (config.variableSecretKeys), unsealed at run,
 *   and the assigned variable masks on every output surface.
 * Carrier O: a JSON Parser reads a secret input document (a secret
 *   variable referenced via an expression field - the supported pattern for
 *   sensitive input data, since the engine masks a declared secret everywhere
 *   including its own masked input echo) and binds an extracted field to a
 *   variable marked secret. The document seals at rest, the extracted value
 *   masks on every output surface, and neither ever appears in cleartext.
 *
 * Pass Criteria:
 *  1. At rest: the setter literal AND the secret input document are wave:enc:v1:
 *     envelopes on disk; neither canary appears in the store; a run unseals them
 *     (the slice proofs print the real suffixes).
 *  2. Real values at run: `s-proof=sierra-real-bytes` and `o-proof=oscar-real-bytes`
 *     both print; `pub=pub-visible-marker` prints raw
 *  3. Masking: each direct log collapses to a bare ********; neither canary
 *     appears in any console line, WS payload, session-variable read, or report
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import {
  importValidateAndNavigate,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { BACKEND_URL, STORAGE_BASE_PATH } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const CANARY_S = 'STseal-7a2-sierra-real-bytes' // setter secret literal
const CANARY_O = 'OBbind-4c8-oscar-real-bytes' // output-bound secret
// A variable declared PLAIN in the Variable Manager but marked secret ONLY on
// a Variable Setter row - the run must still flag it.
const CANARY_V = 'VMonly-9f3-victor-real-bytes'
const S_SUFFIX = 'sierra-real-bytes' // CANARY_S[11:]
const O_SUFFIX = 'oscar-real-bytes' // CANARY_O[11:]
const V_SUFFIX = 'victor-real-bytes' // CANARY_V[11:]
const PUBLIC_MARKER = 'pub-visible-marker'
const MASK = '********'
const ENVELOPE = 'wave:enc:v1:'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

function testDirBytes(testId: string): Buffer {
  const dir = path.join(STORAGE_BASE_PATH, 'api_tests', testId)
  return Buffer.concat(listFiles(dir).map((file) => fs.readFileSync(file)))
}

function sweepStore(needle: string): string[] {
  return listFiles(STORAGE_BASE_PATH).filter((file) => fs.readFileSync(file).includes(needle))
}

test.describe('V-SECRET-NEW-CARRIERS-FUNCTIONAL', () => {
  test('setter literal sealed at rest, output-bound secret masks, both run on the real bytes', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const testId = await importValidateAndNavigate(page, loadFixture())

    await test.step('Criterion 1: setter literal + secret input document sealed on disk; neither canary in the store', async () => {
      const bytes = testDirBytes(testId)
      expect(bytes.includes(ENVELOPE), 'the secret node config must carry a sealed envelope').toBeTruthy()
      expect(bytes.includes(CANARY_S), 'the setter secret literal must not sit in cleartext').toBeFalsy()
      expect(bytes.includes(CANARY_O), 'the secret input document must not sit in cleartext').toBeFalsy()
      expect(sweepStore(CANARY_S), 'the setter secret leaked into the store').toEqual([])
      expect(sweepStore(CANARY_O), 'the secret input document leaked into the store').toEqual([])
    })

    // Grab the session and subscribe inside the fixture's leading Delay window.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    let logTexts: string[] = []
    await test.step('Criterion 2: the run passes and both carriers slice the real suffix', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
      await expect(status).toHaveAttribute('data-status', 'passed')

      logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')
      expect(
        logTexts.some((t) => t === `s-proof=${S_SUFFIX}`),
        `Expected the setter secret slice proof. Got:\n${all}`,
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t === `o-proof=${O_SUFFIX}`),
        `Expected the output-bound secret slice proof. Got:\n${all}`,
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t === `pub=${PUBLIC_MARKER}`),
        `Expected the public output logged raw. Got:\n${all}`,
      ).toBeTruthy()
      // The VM-plain / setter-secret variable still runs on its real bytes.
      expect(
        logTexts.some((t) => t === `vp-proof=${V_SUFFIX}`),
        `Expected the VM-plain setter-secret slice proof. Got:\n${all}`,
      ).toBeTruthy()
    })

    await test.step('Criterion 3: each direct log collapses to a bare ********; no canary in the console', async () => {
      const all = logTexts.join('\n')
      const bareMask = logTexts.filter((t) => t === MASK)
      expect(
        bareMask.length,
        `Expected >= 3 bare "${MASK}" lines (setter + output + VM-plain direct). Got:\n${all}`,
      ).toBeGreaterThanOrEqual(3)
      expect(all).not.toContain(CANARY_S)
      expect(all).not.toContain(CANARY_O)
      // A name marked secret only on a setter row masks.
      expect(all, `VM-plain setter-secret leaked into the console:\n${all}`).not.toContain(CANARY_V)
    })

    await test.step('Criterion 3: WS payload sweep - neither canary in any event', async () => {
      const events = await collector.harvest()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
      for (const evt of events) {
        const json = JSON.stringify(evt)
        expect(json, `WS payload leaked the setter secret: ${json}`).not.toContain(CANARY_S)
        expect(json, `WS payload leaked the output-bound secret: ${json}`).not.toContain(CANARY_O)
        expect(json, `WS payload leaked the VM-plain setter-secret: ${json}`).not.toContain(CANARY_V)
      }
      await collector.close()
    })

    await test.step('Criterion 3: session variables read - both secrets masked, public raw', async () => {
      const variables = await getSessionVariables(page, sessionId)
      expect(variables.setter_secret.value).toBe(MASK)
      expect(variables.bound_secret.value).toBe(MASK)
      expect(variables.bound_public.value).toBe(PUBLIC_MARKER)
      expect(
        variables.vm_plain_setter_secret.value,
        'a setter-marked secret must mask in the session read',
      ).toBe(MASK)
      const json = JSON.stringify(variables)
      expect(json).not.toContain(CANARY_S)
      expect(json).not.toContain(CANARY_O)
      expect(json).not.toContain(CANARY_V)
    })

    await test.step('Criterion 3: report content masked (slice proofs present, no canary)', async () => {
      const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(genResp.status(), await genResp.text()).toBe(200)
      const contentResp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
      )
      expect(contentResp.ok()).toBeTruthy()
      const report = await contentResp.text()
      expect(report).toContain(`s-proof=${S_SUFFIX}`)
      expect(report).toContain(`o-proof=${O_SUFFIX}`)
      expect(report).toContain(`vp-proof=${V_SUFFIX}`)
      expect(report).not.toContain(CANARY_S)
      expect(report).not.toContain(CANARY_O)
      expect(report).not.toContain(CANARY_V)
    })

    await test.step('Criterion 1: the post-run store sweep still finds neither secret', async () => {
      expect(sweepStore(CANARY_S), 'the setter secret persisted by the run').toEqual([])
      expect(sweepStore(CANARY_O), 'the secret input document persisted by the run').toEqual([])
      expect(sweepStore(CANARY_V), 'the VM-plain setter-secret persisted by the run').toEqual([])
    })
  })
})
