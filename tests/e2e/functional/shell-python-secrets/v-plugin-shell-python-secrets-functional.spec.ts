/**
 * V-PLUGIN-SHELL-PYTHON-SECRETS-FUNCTIONAL: Shell Script / Python marked-output canary
 * Wireframe: N/A (no visual surface)
 * Design Decisions: SHRUN-6, SHRUN-8
 * REQ: REQ-3.1.3.5
 *
 * Pass Criteria:
 * 1. The run passes, and the non-secret proofs stay visible: the Shell Script export
 *    SHELL_PROOF binds `shell-ran-42` as a plain value, and both Outputs echoes carry
 *    their proof (`shell-ran-42`, `py-ran-42`).
 * 2. The marked Shell Script stdout, the marked SHELL_TOKEN export and the marked
 *    Python output read the mask in the session variables, and no canary sits there.
 * 3. The INFO console carries the masked Log lines and the cleartext non-secret
 *    bookend, and no canary.
 * 4. No raw pre-masking output dump (`Shell Script output:`, `Extracted SHELL_TOKEN=`,
 *    `Extracted py_token=`) appears on the console or in the WS stream.
 * 5. The DEBUG Outputs echo of each block masks its marked outputs and carries no canary.
 *
 * The script source and the Python code contain the canaries as the user's own code and
 * ride the DEBUG Inputs echo, which is not a masked-value surface, so the leak sweeps are
 * scoped to the output surfaces.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import {
  importValidateAndNavigate,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { ensureEnvironment } from '../../helpers/config'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { deleteTest } from '../file-picker/picker'
import fs from 'fs'
import path from 'path'

// Planted canaries (must match fixture.json); one family prefix backs up the exact sweeps.
const CANARY_SHELL_OUT = 'spsec-shellout-11aa22bb-real'
const CANARY_SHELL_STDOUT = 'spsec-shellstd-33cc44dd-real'
const CANARY_PY_OUT = 'spsec-pyout-55ee66ff-real'
const FAMILY = 'spsec-'
const SECRETS = [CANARY_SHELL_OUT, CANARY_SHELL_STDOUT, CANARY_PY_OUT]
const SHELL_PROOF = 'shell-ran-42'
const PY_PROOF = 'py-ran-42'
const PLAIN = 'plain-visible-sp-0000'
const MASK = SECRET_MASK

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

function debugMessages(events: Array<Record<string, unknown>>): string[] {
  return events
    .map((event) => event.message)
    .filter((message): message is string => typeof message === 'string')
}

test.describe('V-PLUGIN-SHELL-PYTHON-SECRETS-FUNCTIONAL', () => {
  const createdTests: string[] = []

  test.afterAll(async ({ request }) => {
    for (const testId of createdTests) await deleteTest(request, testId)
  })

  test('a Shell Script / Python marked output masks on every output surface', async ({
    page,
  }: {
    page: Page
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    createdTests.push(await importValidateAndNavigate(page, loadFixture()))

    // The leading Delay holds the run so the collector subscribes before any output flows.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    await test.step('the run passes', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
      await expect(status).toHaveAttribute('data-status', 'passed')
    })

    await test.step('session variables: the marked outputs mask, the proof export is plain', async () => {
      const variables = await getSessionVariables(page, sessionId)
      expect(variables.shell_stdout.value, 'the marked Shell Script stdout must be masked').toBe(MASK)
      expect(variables.shell_token.value, 'the marked SHELL_TOKEN export must be masked').toBe(MASK)
      expect(variables.py_token_var.value, 'the marked python output var must be masked').toBe(MASK)
      expect(variables.shell_proof.value, 'the non-secret SHELL_PROOF export binds as is').toBe(
        SHELL_PROOF,
      )
      expectNoSecret(JSON.stringify(variables), 'session variables', SECRETS, FAMILY)
    })

    await test.step('console (INFO): the marked output values mask, plain sibling cleartext', async () => {
      const logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')
      expect(
        logTexts.some((t) => t === 'shell-out=******** shell-done'),
        `shell log line must mask the marked output. Got:\n${all}`,
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t === 'py-out=******** py-done'),
        `python log line must mask the marked output. Got:\n${all}`,
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t === `plain=${PLAIN} shell-python-secrets-done`),
        `non-secret sibling must stay cleartext. Got:\n${all}`,
      ).toBeTruthy()
      expectNoSecret(all, 'console log', SECRETS, FAMILY)
    })

    await test.step('no raw pre-masking output dump on any surface', async () => {
      const logTexts = await getLogTexts(page)
      const events = await collector.harvest()
      const all = [logTexts.join('\n'), ...debugMessages(events)].join('\n')
      expect(all, 'no `Shell Script output:` raw dump').not.toContain('Shell Script output:')
      expect(all, 'no `Extracted SHELL_TOKEN=` dump').not.toContain('Extracted SHELL_TOKEN=')
      expect(all, 'no `Extracted py_token=` dump').not.toContain('Extracted py_token=')
    })

    await test.step('the masked harness Outputs echo masks the marked outputs, proof visible (DEBUG)', async () => {
      const messages = debugMessages(await collector.harvest())
      await collector.close()
      const shellOutputs = messages.find(
        (m) => m.startsWith('Outputs:') && m.includes(SHELL_PROOF),
      )
      expect(
        shellOutputs,
        `a masked Outputs line for the Shell Script block must broadcast at DEBUG. Got:\n${messages.join('\n')}`,
      ).toBeTruthy()
      expect(shellOutputs!, 'the marked stdout must mask in the Outputs echo').toContain(
        `"stdout":"${MASK}"`,
      )
      expect(shellOutputs!, 'the marked SHELL_TOKEN export must mask in the Outputs echo').toContain(
        `"SHELL_TOKEN":"${MASK}"`,
      )
      expect(shellOutputs!, 'the non-secret SHELL_PROOF export shows as a plain value').toContain(
        `"SHELL_PROOF":"${SHELL_PROOF}"`,
      )
      expectNoSecret(shellOutputs!, 'Shell Script Outputs line', SECRETS, FAMILY)
      const pyOutputs = messages.find((m) => m.startsWith('Outputs:') && m.includes(PY_PROOF))
      expect(
        pyOutputs,
        `a masked Outputs line for the python block must broadcast at DEBUG. Got:\n${messages.join('\n')}`,
      ).toBeTruthy()
      expect(pyOutputs!, 'the marked python output must mask in the Outputs echo').toContain(
        `"py_token":"${MASK}"`,
      )
      expectNoSecret(pyOutputs!, 'python Outputs line', SECRETS, FAMILY)
    })
  })
})
