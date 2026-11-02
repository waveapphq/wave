/**
 * SH-15: Shell Exec shell choice, pipes, shell flags, Input Variables and console label
 * Design Decisions: SHRUN-5, SHRUN-12, SHRUN-17, SHRUN-18
 * REQ: REQ-3.4.1.18
 *
 * Pass Criteria:
 * 1. Shell `/bin/bash` runs a bash-only test: stdout binds exactly `bash-ok`.
 * 2. Shell `/bin/sh` (dash) runs the same command under Record and continue: Exit Code 127,
 *    Reason `NonZeroExit`, Stderr contains `[[: not found`, Error exactly
 *    `Command exited with code 127: /bin/sh: 1: [[: not found`, and the block paints the
 *    recorded-warning state.
 * 3. A pipe works: `printf 'a\nb\nc\n' | grep -c .` binds exactly `3`, and with Log Output ticked its
 *    one console line `3` sits at INFO with source `Shell Exec`.
 * 4. Shell flags are honored: under `/bin/bash -o pipefail`, `false | true; echo "rc=$?"` binds
 *    exactly `rc=1`.
 * 5. An Input Variable from an expression reaches the command's environment: `echo "hi $NAME"`
 *    binds exactly `hi wave-<token>`.
 * 6. The run passes.
 */

import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts } from '../../helpers/log-reader'
import { deleteTest } from '../file-picker/picker'
import { consoleEntriesFromCopy, newToken, stripOneNewline, withToken } from './shell-helpers'

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<string, unknown>
}

/** A session variable's text with one trailing newline removed. */
function streamText(variables: Record<string, { value: unknown }>, name: string): string {
  expect(variables[name], `session variable ${name}`).toBeDefined()
  return stripOneNewline(String(variables[name].value))
}

test.describe('SH-15: Shell Exec', () => {
  const createdTests: string[] = []

  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterAll(async ({ request }) => {
    for (const testId of createdTests) await deleteTest(request, testId)
  })

  test('SH-15 Shell Exec runs one command line through the chosen shell', async ({ page }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const testId = await importValidateAndNavigate(page, withToken(loadFixture('fixture-shell-exec.json'), token))
    createdTests.push(testId)

    const status = await startRun(page)
    await finishRun(page, status, `SH-15-done-${token}`)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('Shell /bin/bash runs a bash test', async () => {
      expect(streamText(variables, 'c1_out')).toBe('bash-ok')
    })

    await test.step('Shell /bin/sh refuses the same bash test and records it', async () => {
      expect(variables.c2_code.value).toBe(127)
      expect(variables.c2_reason.value).toBe('NonZeroExit')
      expect(String(variables.c2_stderr.value)).toContain('[[: not found')
      expect(variables.c2_msg.value).toBe('Command exited with code 127: /bin/sh: 1: [[: not found')
      await expectNodeStatus(page, 'sh-exec-sh', 'warning')
    })

    await test.step('a pipe counts the lines and Log Output labels its line Shell Exec', async () => {
      expect(streamText(variables, 'c3_out')).toBe('3')
      const lines = consoleEntriesFromCopy(await getLogCopyTexts(page)).filter((entry) => entry.message === '3')
      expect(lines, `console lines reading "3": ${JSON.stringify(lines)}`).toHaveLength(1)
      expect(lines[0].level).toBe('INFO')
      expect(lines[0].source).toBe('Shell Exec')
    })

    await test.step('shell flags apply to the command', async () => {
      expect(streamText(variables, 'c4_out')).toBe('rc=1')
    })

    await test.step('an Input Variable from an expression reaches the environment', async () => {
      expect(streamText(variables, 'c5_out')).toBe(`hi wave-${token}`)
    })

    await expectNodesSuccess(page, ['sh-exec-bash', 'sh-exec-pipe', 'sh-exec-flags', 'sh-exec-env'])
  })
})
