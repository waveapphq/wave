/**
 * SH-12: Shell Script Working Directory unset and picked with Browse; Browse and locus inside a Remote Execution body
 * Design Decisions: SHRUN-1, SHRUN-10, SHRUN-11, SHRUN-17, TDATA-8, TDATA-9
 * REQ: REQ-3.4.1.1, REQ-3.4.1.18, REQ-3.4.3.1, REQ-3.4.3.11
 *
 * Pass Criteria:
 * 1. A Shell Script whose Working Directory is left unset starts in the temp folder Python reports on
 *    WAVE: its `pwd` equals what a Python block printing `tempfile.gettempdir()` binds in the same run.
 * 2. Browse on Working Directory, in folder mode, offers the folder the first run wrote under the
 *    session's artifacts; picking it shows `artifact://` and the path `sh-12-<token>` on the Reference
 *    line and writes `artifact://sh-12-<token>` into the row and the saved Test.
 * 3. A second full run starts the script in that folder: its `pwd` ends with `/sh-12-<token>`.
 * 4. Inside a Remote Execution body the Shell Script and the Shell Exec carry the locus badge L
 *    (File I/O, remotable, carries R); both keep Browse on Working Directory, the Shell Script also
 *    on Script File once Script Type is File, and the File I/O has no Browse on Path.
 * 5. A Shell Script inside a Remote Execution body runs on WAVE: its `hostname` equals the one a
 *    Shell Script printed before the SSH open, and differs from the one SSH Session Exec printed
 *    in the same body over the session.
 */

import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { clearConsoleLogs, waitForLogText } from '../../helpers/log-reader'
import {
  closeConfig,
  confirmPicker,
  deleteTest,
  expandGroup,
  expectReference,
  expectRowValue,
  importWithTestData,
  openConfig,
  openPicker,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import { newToken, stripOneNewline, withToken } from './shell-helpers'

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<string, unknown>
}

function locusBadge(page: Page, nodeId: string): Locator {
  return page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-remote-locus-badge"]`)
}

/** A session variable's text with one trailing newline removed. */
function streamText(variables: Record<string, { value: unknown }>, name: string): string {
  expect(variables[name], `session variable ${name}`).toBeDefined()
  return stripOneNewline(String(variables[name].value))
}

async function selectScriptType(page: Page, dialog: Locator, label: 'Source' | 'File'): Promise<void> {
  const select = dialog.getByRole('combobox', { name: 'Script Type' })
  await select.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(select).toContainText(label)
}

/** Close a sheet whose edits must not be kept. */
async function discardConfig(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: /^Cancel$/ }).last().click()
  const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(unsaved).toBeVisible()
  await unsaved.getByTestId('unsaved-close').click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

test.describe('SH-12: Working Directory and Browse', () => {
  const createdTests: string[] = []

  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterAll(async ({ request }) => {
    for (const testId of createdTests) await deleteTest(request, testId)
  })

  test('SH-12 an unset Working Directory starts in the system temp folder, and Browse picks an artifacts folder', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const folder = `sh-12-${token}`
    const bookend = `SH-12-done-${token}`
    const testId = await importValidateAndNavigate(page, withToken(loadFixture('fixture-paths.json'), token))
    createdTests.push(testId)

    await test.step('run 1: an unset Working Directory starts the script in the temp folder Python reports', async () => {
      const status = await startRun(page)
      await finishRun(page, status, bookend)
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      const systemTemp = streamText(variables, 'wave_temp')
      expect(path.isAbsolute(systemTemp), `Python printed an absolute temp folder: "${systemTemp}"`).toBe(true)
      expect(streamText(variables, 'wd_default')).toBe(systemTemp)
    })

    await test.step('Browse picks the artifacts folder run 1 wrote', async () => {
      const dialog = await openConfig(page, 'sh-pwd-art')
      await expandGroup(dialog, 'Execution')
      const picker = await openPicker(page, dialog, 'working_dir', 'folder')
      await picker.artifactsTab.click()
      await picker.artifactFolder(folder).click()
      await expectReference(picker, 'artifact://', folder)
      await confirmPicker(picker)
      await expectRowValue(dialog, 'working_dir', `artifact://${folder}`)
      await saveConfig(dialog)
      await saveWorkbench(page)

      const nodes = await persistedNodes(request, testId)
      expect(nodes['sh-pwd-art'].config.values.working_dir).toBe(`artifact://${folder}`)
      expect(nodes['sh-pwd-art'].expressionFields ?? []).not.toContain('working_dir')
    })

    await test.step('run 2: the picked folder is where the script starts', async () => {
      const oldSid = await getActiveSessionId(page)
      await clearConsoleLogs(page)
      await page.locator('[data-testid="run-button"]').click()
      let newSid = ''
      await expect
        .poll(
          async () => {
            newSid = await getActiveSessionId(page)
            return newSid
          },
          { timeout: 30_000, message: 'the full run must start a new session' },
        )
        .not.toBe(oldSid)
      const status = page.locator('[data-testid="workflow-status"]')
      await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 30_000 })
      await waitForLogText(page, bookend, 30_000)

      const variables = await getSessionVariables(page, newSid)
      expect(streamText(variables, 'wd_art')).toMatch(new RegExp(`^/.+/${folder}$`))
    })
  })

  test('SH-12 inside a Remote Execution body both shell blocks run on WAVE and keep Browse', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const testId = await importValidateAndNavigate(
      page,
      withToken(loadFixture('fixture-remote-gating.json'), token),
    )
    createdTests.push(testId)

    await test.step('the locus badges: shell blocks L, File I/O R', async () => {
      await expect(locusBadge(page, 'shell-script-inside')).toHaveAttribute('data-locus', 'L')
      await expect(locusBadge(page, 'shell-exec-inside')).toHaveAttribute('data-locus', 'L')
      await expect(locusBadge(page, 'fio-inside')).toHaveAttribute('data-locus', 'R')
    })

    await test.step('Shell Script keeps Browse on Working Directory and Script File', async () => {
      const dialog = await openConfig(page, 'shell-script-inside')
      await expandGroup(dialog, 'Execution')
      await expect(dialog.getByTestId('param-browse-working_dir')).toHaveCount(1)
      await selectScriptType(page, dialog, 'File')
      await expect(dialog.getByTestId('param-browse-script_file')).toHaveCount(1)
      await discardConfig(page, dialog)
    })

    await test.step('Shell Exec keeps Browse on Working Directory', async () => {
      const dialog = await openConfig(page, 'shell-exec-inside')
      await expandGroup(dialog, 'Execution')
      await expect(dialog.getByTestId('param-browse-working_dir')).toHaveCount(1)
      await closeConfig(dialog)
    })

    await test.step('File I/O in the same body has no Browse on Path', async () => {
      const dialog = await openConfig(page, 'fio-inside')
      await expect(dialog.locator('[data-testid="param-row-path"]')).toBeVisible()
      await expect(dialog.getByTestId('param-browse-path')).toHaveCount(0)
      await closeConfig(dialog)
    })
  })

  test('SH-12 a Shell Script inside a Remote Execution body runs on WAVE, not on the host', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const testId = await importWithTestData(
      page,
      withToken(loadFixture('fixture-remote-body.json'), token),
      [],
      { injectSsh: true },
    )
    createdTests.push(testId)

    const status = await startRun(page)
    await finishRun(page, status, `SH-12-done-${token}`)
    await expectNodeStatus(page, 'shell-script-inside', 'success')
    await expect(locusBadge(page, 'shell-script-inside')).toHaveAttribute('data-locus', 'L')

    const variables = await getSessionVariables(page, await getActiveSessionId(page))
    const waveHost = streamText(variables, 'wave_host')
    const bodyHost = streamText(variables, 'body_host')
    const sshHost = streamText(variables, 'ssh_host')
    expect(waveHost, 'the top-level Shell Script printed a hostname').not.toBe('')
    expect(sshHost, 'SSH Session Exec printed the host hostname').not.toBe('')
    expect(bodyHost, 'the in-body Shell Script ran on WAVE').toBe(waveHost)
    expect(bodyHost, 'the in-body Shell Script did not run on the host').not.toBe(sshHost)
  })
})
