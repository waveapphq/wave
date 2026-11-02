/**
 * SH-2: Shell Script Script Type File through Browse; Script file not found under Record
 * Design Decisions: SHRUN-3, SHRUN-9, TDATA-8, TDATA-9
 * REQ: REQ-3.4.1.1
 *
 * Pass Criteria:
 * 1. On `sh-file`, Source shows the Script row and no Script File; selecting File hides
 *    Script and shows Script File with Browse.
 * 2. Browse opens the picker in file mode; picking `scripts/hello.sh` in the Test Data tab
 *    shows `testdata://` and the path `scripts/hello.sh` on the Reference line, writes
 *    `testdata://scripts/hello.sh` into the row, and the saved node keeps File mode and
 *    that reference.
 * 3. The run verdict is not failed, `sh-file` paints success, and `file_out` reads
 *    `file-mode ok`: the script ran under the Shell row, ignoring its python shebang.
 * 4. `sh-file-missing` (Record and continue): `m_ok` false, `m_reason` `StartFailed`,
 *    `m_err` exactly `Script file not found: testdata://scripts/missing-<token>.sh`,
 *    `m_code` -1, and the node paints warning (amber).
 * 5. Exactly one WARN console entry reads
 *    `Script failed (StartFailed): Script file not found: testdata://scripts/missing-<token>.sh`.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import { startRun, finishRunAnyVerdict, expectNodeStatus } from '../../helpers/k8s-run'
import { getLogEntries } from '../../helpers/log-reader'
import {
  confirmPicker,
  deleteTest,
  expectReference,
  expectRowValue,
  importWithTestData,
  openConfig,
  openPicker,
  persistedNodes,
  saveConfig,
  saveWorkbench,
  type SeedFile,
} from '../file-picker/picker'
import { newToken, stripOneNewline, withToken } from './shell-helpers'

const FILE_NODE = 'sh-file'
const MISSING_NODE = 'sh-file-missing'
const PICKED = 'testdata://scripts/hello.sh'

const SCRIPT_FILES: SeedFile[] = [
  {
    folder: 'scripts',
    name: 'hello.sh',
    body: Buffer.from('#!/usr/bin/python3\necho "file-mode $1"\n'),
  },
]

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-script-file.json'), 'utf-8'))
  return withToken(raw, token)
}

test.describe('SH-2: Shell Script runs a Script File picked through Browse', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('SH-2 File mode through Browse runs; a missing Script File records StartFailed', async ({
    page,
  }: {
    page: Page
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const missingMessage = `Script file not found: testdata://scripts/missing-${token}.sh`
    testId = await importWithTestData(page, loadFixture(token), SCRIPT_FILES)

    await test.step('File mode swaps Script for Script File and Browse picks the Test Data file', async () => {
      const dialog = await openConfig(page, FILE_NODE)
      await expect(dialog.getByTestId('param-row-script')).toBeVisible()
      await expect(dialog.getByTestId('param-row-script_file')).toHaveCount(0)

      await dialog.getByRole('combobox', { name: 'Script Type' }).click()
      await page.getByRole('option', { name: 'File', exact: true }).click()
      await expect(dialog.getByRole('combobox', { name: 'Script Type' })).toContainText('File')

      await expect(dialog.getByTestId('param-row-script')).toHaveCount(0)
      await expect(dialog.getByTestId('param-row-script_file')).toBeVisible()
      await expect(dialog.getByTestId('param-browse-script_file')).toBeVisible()

      const picker = await openPicker(page, dialog, 'script_file', 'file')
      await expect(picker.testDataTab).toHaveAttribute('aria-pressed', 'true')
      await picker.file('scripts/hello.sh').click()
      await expectReference(picker, 'testdata://', 'scripts/hello.sh')
      await confirmPicker(picker)

      await expectRowValue(dialog, 'script_file', PICKED)
      await saveConfig(dialog)
      await saveWorkbench(page)

      const values = (await persistedNodes(page.request, testId as string))[FILE_NODE].config.values
      expect(values.script_type).toBe('file')
      expect(values.script_file).toBe(PICKED)
    })

    await test.step('the run ends without failing', async () => {
      const status = await startRun(page)
      const { verdict } = await finishRunAnyVerdict(page, status, `SH-2-done-${token}`)
      expect(verdict).not.toBe('failed')
    })

    await test.step('the picked file ran under the Shell row, ignoring its shebang', async () => {
      await expectNodeStatus(page, FILE_NODE, 'success')
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(stripOneNewline(String(variables.file_out.value))).toBe('file-mode ok')
    })

    await test.step('a missing Script File records StartFailed with exit code -1', async () => {
      await expectNodeStatus(page, MISSING_NODE, 'warning')
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(variables.m_ok.value).toBe(false)
      expect(variables.m_reason.value).toBe('StartFailed')
      expect(variables.m_err.value).toBe(missingMessage)
      expect(variables.m_code.value).toBe(-1)
    })

    await test.step('one WARN console entry names the recorded failure', async () => {
      const expected = `Script failed (StartFailed): ${missingMessage}`
      const entries = await getLogEntries(page)
      const matches = entries.filter((entry) => entry.level === 'WARN' && entry.message === expected)
      expect(
        matches,
        `expected one WARN "${expected}". Got:\n${entries.map((e) => `[${e.level}] ${e.message}`).join('\n')}`,
      ).toHaveLength(1)
    })
  })
})
