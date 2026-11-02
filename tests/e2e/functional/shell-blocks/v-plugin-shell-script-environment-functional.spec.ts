/**
 * SH-13, SH-14: WAVE_TESTDATA_DIR and WAVE_ARTIFACTS_DIR; the server's environment inherited whole
 * Wireframe: N/A (run behavior, no config sheet state)
 * Design Decisions: SHRUN-2, SHRUN-11, SHRUN-18, TDATA-2
 * REQ: REQ-3.4.1.1, REQ-3.4.1.18, REQ-3.4.3.1, REQ-3.4.3.2
 *
 * Pass Criteria:
 * 1. SH-13: a script reads the Test's own Test Data file through `$WAVE_TESTDATA_DIR`: stdout binds
 *    exactly `td-<token>`.
 * 2. SH-13: a file the script writes under `$WAVE_ARTIFACTS_DIR/sh-13-<token>/` is a session
 *    artifact: the Session Artifacts sheet lists exactly one `out.txt` row, whose folder subtitle
 *    reads exactly `sh-13-<token>`.
 * 3. SH-13: a script's write into its own Test Data fails with the operating system's refusal
 *    under Record and continue: Exit Code 1, Reason `NonZeroExit`, Stderr contains
 *    `Permission denied`, Error exactly `Script exited with code 1: ` followed by the last Stderr
 *    line cut to 200 characters; the block paints the
 *    recorded-warning state, and the Test Data listing still holds the seeded file and has no
 *    `inputs/new-<token>.txt`.
 * 4. SH-14: the Shell Script sees WAVE_CONFIG_FILE, WAVE_ADMIN_ALLOWED, WAVE_STORAGE_BASE_PATH,
 *    WAVE_TESTDATA_DIR and WAVE_ARTIFACTS_DIR (stdout lines exactly
 *    `[present][present][present][present][present]` and `rc=0`), and a Shell Exec sees
 *    WAVE_CONFIG_FILE (`rc=0`). Only presence is asserted, never a value.
 * 5. The run passes.
 */

import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { listTestDataPaths } from '../../helpers/testdata'
import { deleteTest, importWithTestData } from '../file-picker/picker'
import { newToken, stripOneNewline, withToken } from './shell-helpers'

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<string, unknown>
}

/** A session variable's text with one trailing newline removed. */
function streamText(variables: Record<string, { value: unknown }>, name: string): string {
  expect(variables[name], `session variable ${name}`).toBeDefined()
  return stripOneNewline(String(variables[name].value))
}

test.describe('SH-13, SH-14: the WAVE directories and the inherited environment', () => {
  const createdTests: string[] = []

  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterAll(async ({ request }) => {
    for (const testId of createdTests) await deleteTest(request, testId)
  })

  test('SH-13 SH-14 a script reads Test Data, writes artifacts, cannot write Test Data, and inherits the server environment', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const seedName = `data-${token}.txt`
    const testId = await importWithTestData(page, withToken(loadFixture('fixture-environment.json'), token), [
      { folder: 'inputs', name: seedName, body: Buffer.from(`td-${token}`) },
    ])
    createdTests.push(testId)

    const status = await startRun(page)
    await finishRun(page, status, `SH-13-done-${token}`)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('SH-13: the Test Data file is read through WAVE_TESTDATA_DIR', async () => {
      expect(streamText(variables, 'td_out')).toBe(`td-${token}`)
      await expectNodeStatus(page, 'sh-td', 'success')
    })

    await test.step('SH-13: the file written under WAVE_ARTIFACTS_DIR is a session artifact', async () => {
      await page.locator('[data-testid="breadcrumb-artifacts-chip"]').click()
      const sheet = page.locator('[data-testid="session-artifacts-sheet"]')
      await expect(sheet).toBeVisible()
      const row = sheet.locator('[data-testid="file-row"]').filter({ hasText: 'out.txt' })
      await expect(row).toHaveCount(1, { timeout: 15_000 })
      await expect(row.locator('[data-testid="artifact-file-subtitle"]')).toHaveText(`sh-13-${token}`)
    })

    await test.step('SH-13: a write into Test Data is refused by the operating system', async () => {
      expect(variables.w_code.value).toBe(1)
      expect(variables.w_reason.value).toBe('NonZeroExit')
      const stderr = String(variables.w_stderr.value)
      expect(stderr).toContain('Permission denied')
      const lastLine = stderr.trim().split('\n').pop()!.trim().slice(0, 200)
      expect(variables.w_msg.value).toBe(`Script exited with code 1: ${lastLine}`)
      await expectNodeStatus(page, 'sh-td-write', 'warning')

      const paths = await listTestDataPaths(request, testId)
      expect(paths, 'the seeded file is still listed').toContain(`inputs/${seedName}`)
      expect(paths, 'the refused write left no file').not.toContain(`inputs/new-${token}.txt`)
    })

    await test.step('SH-14: the server environment reaches both blocks whole', async () => {
      expect(streamText(variables, 'env_out')).toBe(
        '[present][present][present][present][present]\nrc=0',
      )
      expect(streamText(variables, 'env_exec_out')).toBe('rc=0')
    })
  })
})
