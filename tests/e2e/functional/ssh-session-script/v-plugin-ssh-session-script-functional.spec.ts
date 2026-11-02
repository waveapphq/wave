/**
 * V-PLUGIN-SSH-SESSION-SCRIPT-FUNCTIONAL: SSH Session Script real execution E2E
 *
 * One fixture, run twice against the real-service stack (tests/e2e/services/):
 * once on the main OpenSSH host (:9445) and once on the SFTP-disabled host
 * (:9447) - the same five-interpreter matrix passing on both proves the
 * stdin-piping transport needs no SFTP subsystem.
 *
 *   script-sh      -> /bin/sh   `echo $((6*7))`          -> 42
 *   script-bash    -> bash      arithmetic guarded by $BASH_VERSION -> 42-bash
 *   script-py      -> python3   `print(6*7)`             -> 42
 *   script-perl    -> perl      `print 6*7`              -> 42
 *   script-node    -> node      `console.log(6*7)`       -> 42
 *   script-missing -> a bogus interpreter returns the shell's real 127
 *   script-exit    -> `exit 9` propagates (returned, not raised)
 *   script-wd      -> working_dir set to a folder the run makes under the remote
 *                     home and removes after (`pwd` prints that folder)
 *   script-timeout -> `sleep 30` with timeout=2 raises the plugin's exact
 *                     TimeoutError (caught; bound error readable post-catch)
 *
 * Each node rides the SAME session_id and binds stdout/exit_code to distinct
 * variables. Every stdout is a value only the REAL interpreter computes - if
 * the plumbing routed the wrong script or interpreter, the value vanishes.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.5 (real-service harness)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, waitForLogText } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  BACKEND_PORT,
  E2E_ENV_NAME,
  SSH_NO_SFTP_PORT,
  ensureEnvironment,
} from '../../helpers/config'
import { injectServiceHost } from '../../helpers/fixture-import'
import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'

const TOKEN_PLACEHOLDER = '__TOKEN__'

/** The fixture with a per-run token, and the working_dir folder name that token gives. */
function loadFixture(port?: number): { fixture: Record<string, any>; wdFolder: string } {
  const token = randomUUID().slice(0, 8)
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  const fixture = JSON.parse(raw.split(TOKEN_PLACEHOLDER).join(token))
  fixture.name = `${fixture.name} ${token}`
  if (port) {
    const open = fixture.workflow.nodes.find((n: any) => n.id === 'open-session')
    open.data.config.values.port = port
  }
  return { fixture: injectServiceHost(fixture), wdFolder: `wave-e2e-sss-${token}` }
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
      name: n.textContent?.substring(0, 80) || null,
    }))
  })
}

// interpreter proof marker -> the REAL computed stdout + exit 0. A wrong
// interpreter or script routing cannot produce these values.
const INTERPRETER_PROOFS: Array<{ marker: string; expected: string }> = [
  { marker: 'RESULT sh', expected: 'RESULT sh out=42 code=0' },
  { marker: 'RESULT bash', expected: 'RESULT bash out=42-bash code=0' },
  { marker: 'RESULT py', expected: 'RESULT py out=42 code=0' },
  { marker: 'RESULT perl', expected: 'RESULT perl out=42 code=0' },
  { marker: 'RESULT node', expected: 'RESULT node out=42 code=0' },
]

const NODE_IDS = [
  'open-session', 'log-open',
  'script-sh', 'log-sh', 'script-bash', 'log-bash', 'script-py', 'log-py',
  'script-perl', 'log-perl', 'script-node', 'log-node',
  'script-missing', 'log-missing', 'script-exit', 'log-exit',
  'script-wd-make', 'script-wd', 'log-wd', 'script-wd-clean',
  'tc-timeout', 'log-timeout-caught', 'log-timeout-err', 'log-done',
]

async function runFixtureAndCollectLogs(
  page: Page,
  fixture: Record<string, unknown>,
): Promise<string[]> {
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

  const statusVal = await status.getAttribute('data-status')
  if (statusVal !== 'passed') {
    console.log('=== SSH SCRIPT WORKFLOW FAILED ===')
    console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
    console.log('logs:', (await getLogTexts(page)).join('\n'))
  }
  expect(statusVal).toBe('passed')
  return waitForLogText(page, 'ssh-script-e2e-done')
}

async function assertScriptBehaviors(page: Page, logs: string[], wdFolder: string) {
  const all = logs.join('\n')
  const present = (marker: string) =>
    expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

  await test.step('Session opened', () => {
    present('session opened connected=True')
  })

  for (const { marker, expected } of INTERPRETER_PROOFS) {
    await test.step(`${marker} - the real interpreter computed the value`, () => {
      present(expected)
    })
  }

  await test.step('Missing interpreter returns the real 127', () => {
    present('RESULT missing code=127')
  })

  await test.step('Non-zero exit propagates (returned, not raised)', () => {
    present('RESULT exit code=9')
  })

  await test.step('working_dir honored: pwd prints the folder made under the remote home', () => {
    const line = logs.find((t) => t.includes('RESULT wd out=')) ?? ''
    const match = /RESULT wd out=(\S*) made=(\S*)$/.exec(line.trim())
    expect(match, `Expected the working_dir result line.\n${all}`).not.toBeNull()
    const [, out, made] = match as RegExpExecArray
    expect(made, 'the run made the folder under the remote home').toMatch(new RegExp(`^/\\S+/${wdFolder}$`))
    expect(out, 'pwd prints the working_dir folder').toBe(made)
  })

  await test.step('Timeout raises the plugin\'s exact error (caught)', () => {
    present('timeout-caught')
    const errLine = logs.find((t) => t.includes('timeout-err ')) ?? ''
    expect(errLine, `the bound timeout error must carry the exact message.\n${errLine}`).toContain(
      'Command execution timed out after 2 seconds'
    )
  })

  await test.step('Bookend + node statuses', async () => {
    present('ssh-script-e2e-done')
    for (const id of NODE_IDS) {
      await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
        'data-execution-status',
        'success'
      )
    }
    // The timing-out script is a guarded failure and must not succeed.
    expect(
      await page.locator('[data-testid="workflow-node-script-timeout"]').getAttribute('data-execution-status')
    ).not.toBe('success')
  })
}

test.describe('SSH Session Script real-interpreter E2E Execution', () => {
  test('five real interpreters + 127/exit/working_dir/timeout on the main host', async ({ page }) => {
    const { fixture, wdFolder } = loadFixture()
    const logs = await runFixtureAndCollectLogs(page, fixture)
    await assertScriptBehaviors(page, logs, wdFolder)
  })

  test('the same matrix passes on the SFTP-disabled host (stdin needs no SFTP)', async ({ page }) => {
    const { fixture, wdFolder } = loadFixture(Number(SSH_NO_SFTP_PORT))
    const logs = await runFixtureAndCollectLogs(page, fixture)
    await assertScriptBehaviors(page, logs, wdFolder)
  })
})
