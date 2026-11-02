/**
 * SH-6: Shell Script non-zero exit and the script's own EXIT trap
 * Wireframe: N/A (no visual surface)
 * Design Decisions: SHRUN-7, SHRUN-8, SHRUN-9
 * REQ: REQ-3.4.1.1, REQ-3.2.2.6
 *
 * Pass Criteria:
 * 1. Under Fail the block inside Try/Catch raises: the catch branch runs, the caught
 *    message is exactly "Script exited with code 3: err", the stdout variable still reads
 *    "unset", and no recorded-failure WARN line is written for it.
 * 2. Under Record and continue the same script binds Stdout "out", Stderr "err",
 *    Exit Code 3, Success false, Reason NonZeroExit and Error "Script exited with code 3: err",
 *    writes one recorded-failure WARN line and paints the amber warning state.
 * 3. A script that installs its own EXIT trap replaces WAVE's exit hook: Exit Code 4 and
 *    Reason NonZeroExit bind, the two bound export variables keep their values, one WARN
 *    line says the exports were not read because the script replaced WAVE's exit handler,
 *    and the block paints the amber warning state.
 * 4. The run passes and reaches its bookend.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogEntries } from '../../helpers/log-reader'
import { deleteTest } from '../file-picker/picker'
import { newToken, stripOneNewline, withToken } from './shell-helpers'

const EXIT_3 = 'Script exited with code 3: err'
const RECORDED_EXIT_3 = `Script failed (NonZeroExit): ${EXIT_3}`
const RECORDED_EXIT_4 = 'Script failed (NonZeroExit): Script exited with code 4'
const HOOK_NEVER_RAN = "Variable exports were not read: the script replaced WAVE's exit handler"

const createdTests: string[] = []

function loadFixture(file: string, token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
  return withToken(raw as Record<string, unknown>, token)
}

test.describe('SH-6: Shell Script non-zero exit and EXIT trap', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('SH-6: a non-zero exit fails under Fail, records under Record and continue, and an own EXIT trap leaves the exports unread', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const testId = await importValidateAndNavigate(page, loadFixture('fixture-exit.json', token))
    createdTests.push(testId)

    const status = await startRun(page)
    const sid = await getActiveSessionId(page)
    const logs = await finishRun(page, status, `SH-6-done-${token}`, 90_000)
    const variables = await getSessionVariables(page, sid)
    const warns = (await getLogEntries(page))
      .filter((entry) => entry.level === 'WARN')
      .map((entry) => entry.message)
    const allLogs = logs.join('\n')

    await test.step('Fail inside Try/Catch: the caught message, nothing bound', async () => {
      expect(logs, `the catch branch never ran.\n${allLogs}`).toContain(`SH-6-catch-ran-${token}`)
      const caughtPrefix = `SH-6-caught-${token} msg=`
      const caught = logs.find((text) => text.startsWith(caughtPrefix))
      expect(caught, `no caught-message line.\n${allLogs}`).toBe(`${caughtPrefix}${EXIT_3}`)
      const error = variables.f_error.value as Record<string, unknown>
      expect(error.message).toBe(EXIT_3)
      expect(variables.f_out.value, 'a failed block under Fail binds nothing').toBe('unset')
    })

    await test.step('Record and continue: every output binds', async () => {
      expect(stripOneNewline(String(variables.r_out.value))).toBe('out')
      expect(stripOneNewline(String(variables.r_err.value))).toBe('err')
      expect(variables.r_code.value).toBe(3)
      expect(variables.r_ok.value).toBe(false)
      expect(variables.r_reason.value).toBe('NonZeroExit')
      expect(variables.r_msg.value).toBe(EXIT_3)
      expect(
        warns.filter((message) => message === RECORDED_EXIT_3),
        `only the recorded leg writes the WARN line.\n${warns.join('\n')}`,
      ).toHaveLength(1)
      await expectNodeStatus(page, 'sh-exit-record', 'warning')
    })

    await test.step("the script's own EXIT trap replaces WAVE's hook", async () => {
      expect(variables.t_code.value).toBe(4)
      expect(variables.t_reason.value).toBe('NonZeroExit')
      expect(variables.t_status.value, 'STATUS is not read').toBe('keep-status')
      expect(variables.t_count.value, 'COUNT is not read').toBe(11)
      expect(warns.filter((message) => message === HOOK_NEVER_RAN)).toHaveLength(1)
      expect(warns.filter((message) => message === RECORDED_EXIT_4)).toHaveLength(1)
      await expectNodeStatus(page, 'sh-exit-trap', 'warning')
    })
  })
})
