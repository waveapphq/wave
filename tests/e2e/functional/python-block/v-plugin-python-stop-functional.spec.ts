/**
 * V-PLUGIN-PYTHON-STOP-FUNCTIONAL: Stop a run from the Python script editor
 * Design Decisions: SQL-13, PYRUN-21
 * REQ: REQ-3.4.1.2, REQ-3.2.2.4
 *
 * Pass Criteria:
 * 1. Run on a script that prints a line and then sleeps 60 s turns Run into Stop with a
 *    spinner, and the printed line reaches the run console while the script sleeps.
 * 2. While that run is in flight F1 Help opens and closes, Save stays dead on a changed
 *    draft, and the config sheet behind is read-only (read-only pill, frozen Name, Close in
 *    place of Cancel, no Save).
 * 3. The editor's Stop ends the run within 10 s, far below the 60 s sleep: the session is
 *    stopped, the block is stopped, the console holds the printed line and a WARN
 *    `Stopped by user` from the block, and the line the script prints after its sleep is
 *    on no console line.
 * 4. Run comes back after the Stop, Save takes the changed draft again, and a second Run
 *    of a short script passes with its own line once on the console.
 * 5. Close stays usable during a run: with a changed draft it raises the unsaved prompt,
 *    whose Save the run holds dead, and discarding closes the editor while the run goes
 *    on; the canvas toolbar's Stop then ends it.
 *
 * Needs no stack service: every block runs on the WAVE server.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import fs from 'fs'
import path from 'path'

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { getLogCopyTexts, getLogTexts, waitForLogText } from '../../helpers/log-reader'
import { deleteTest, openConfig } from '../file-picker/picker'
import { consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'
import {
  closeConfigSheet,
  closeEditorWhileRunning,
  expectEditorWhileRunning,
  openScriptSheet,
  runButton,
  saveButton,
  stopButton,
  stopRunFromToolbar,
  typeScript,
  workflowStatus,
} from './editor-helpers'

/** The console source a Python block's own lines carry. */
const SOURCE = 'Python'
const STOP_LINE = 'Stopped by user'

const createdTests: string[] = []

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-run.json'), 'utf-8'),
  ) as Record<string, unknown>
  return withToken(raw, token)
}

/** Markers are joined inside the script, so the DEBUG Inputs echo of its source never matches them. */
function sleeper(token: string, word: string): string {
  return (
    `import time; print('pystop' + '-${word}-' + '${token}', flush=True); ` +
    `time.sleep(60); print('pystop' + '-woke-' + '${token}')`
  )
}

function node(page: Page, nodeId: string): Locator {
  return page.getByTestId(`workflow-node-${nodeId}`)
}

test.describe('V-PLUGIN-PYTHON-STOP-FUNCTIONAL: Stop a run from the Python editor (SQL-13)', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('SQL-13: Stop ends a sleeping script from the editor, and Run comes back', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const token = newToken()
    const armed = `pystop-armed-${token}`
    const woke = `pystop-woke-${token}`
    const second = `pystop-second-${token}`

    const testId = await importValidateAndNavigate(page, loadFixture(token))
    createdTests.push(testId)
    // Expand the console before a sheet can sit over its header.
    await getLogTexts(page)
    await selectEnvironment(page)

    const dialog = await openConfig(page, 'py-main')
    const sheet = await openScriptSheet(page, dialog)

    await test.step('Run turns into Stop and the script prints while it sleeps', async () => {
      await typeScript(page, sheet, sleeper(token, 'armed'))
      await runButton(sheet).click()
      await expect(stopButton(sheet)).toBeVisible({ timeout: 20_000 })
      await waitForLogText(page, armed, 60_000)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'running')
    })

    await test.step('the footer stays usable and the config is read-only during the run', async () => {
      // A changed draft, so only the run can hold Save dead.
      await sheet.locator('.cm-content').first().click()
      await page.keyboard.press('Control+End')
      await page.keyboard.type(' # edited')
      await leaveExpressionEditor(sheet)
      await expectEditorWhileRunning(page, dialog, sheet, 'python')
    })

    await test.step("the editor's Stop ends the run within a few seconds", async () => {
      const clicked = Date.now()
      await stopButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'stopped', {
        timeout: 10_000,
      })
      expect(Date.now() - clicked, 'Stop must not wait for the 60 s sleep').toBeLessThan(10_000)
      await expect(runButton(sheet), 'Run comes back once the run ends').toBeEnabled({
        timeout: 10_000,
      })
      await expect(stopButton(sheet)).toHaveCount(0)
      await expect(sheet.getByTestId('value-editor-run-spinner')).toHaveCount(0)
      await expect(node(page, 'py-main')).toHaveAttribute('data-execution-status', 'stopped')
    })

    await test.step('the console holds the printed line and the stop, never the line after the sleep', async () => {
      await waitForLogText(page, STOP_LINE, 30_000)
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      const dump = JSON.stringify(entries, null, 2)
      expect(entries.filter((entry) => entry.message === armed), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: armed },
      ])
      expect(entries.filter((entry) => entry.message === STOP_LINE), dump).toEqual([
        { level: 'WARN', source: SOURCE, message: STOP_LINE },
      ])
      expect(entries.filter((entry) => entry.message.includes(woke)), dump).toEqual([])
    })

    await test.step('Save takes the changed draft again once the run is over', async () => {
      await expect(saveButton(sheet)).toBeEnabled()
      await expect(dialog.getByTestId('element-config-read-only-pill')).toHaveCount(0)
    })

    await test.step('a second Run works', async () => {
      await typeScript(page, sheet, `print('pystop' + '-second-' + '${token}')`)
      await runButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', {
        timeout: 90_000,
      })
      await waitForLogText(page, second, 60_000)
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      expect(
        entries.filter((entry) => entry.message === second),
        JSON.stringify(entries, null, 2),
      ).toEqual([{ level: 'INFO', source: SOURCE, message: second }])
      await expect(node(page, 'py-main')).toHaveAttribute('data-execution-status', 'success')
    })

    await test.step('Close stays usable during a run and leaves the run going', async () => {
      const armedAgain = `pystop-again-${token}`
      await typeScript(page, sheet, sleeper(token, 'again'))
      await runButton(sheet).click()
      await expect(stopButton(sheet)).toBeVisible({ timeout: 20_000 })
      await waitForLogText(page, armedAgain, 60_000)
      await closeEditorWhileRunning(page, sheet)
      await stopRunFromToolbar(page)
      await expect(node(page, 'py-main')).toHaveAttribute('data-execution-status', 'stopped')
    })

    await closeConfigSheet(page, dialog)
  })
})
