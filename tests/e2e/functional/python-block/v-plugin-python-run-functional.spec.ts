/**
 * V-PLUGIN-PYTHON-RUN: Run from the Python script editor
 * Wireframe: none
 * Design Decisions: PYRUN-20, PYRUN-21, SQL-13
 * REQ: REQ-3.4.1.2, REQ-3.4.2.2
 *
 * Pass Criteria:
 * 1. Run executes ONLY this block, with the unsaved script exactly as it sits in the
 *    editor, and the run ends there: Run turns into Stop while the run is in flight, the
 *    edited script's own line is on the run console, neither Log bookend ran, the sheet
 *    stays open on its draft, and the saved script is still the old one on the canvas
 *    preview and in GET /tests/{id}/workflow.
 * 2. While a debug run is paused at this block, Run is the Repeat Step of THAT block with
 *    the editor's script substituted: the session stays paused on it, a second Run is
 *    another repeat, the upstream Log stays at one entry, and the saved script never runs.
 * 3. With an Environment selected in the toolbar Run does not ask; with none selected it
 *    opens the Run Test dialog, and the Environment picked there becomes the toolbar's.
 * 4. Run sends the block's WHOLE unsaved configuration: an Arguments row edited but not
 *    saved reaches sys.argv, the saved row's value is on no console line, and the server
 *    still holds the saved row.
 * 5. Run is refused only for a finding on THIS block or on a variable it uses: a Log block
 *    with an undeclared variable does not stop it, while this block's own Stdout bound to
 *    an undeclared variable opens the validation dialog and starts nothing.
 * 6. When something other than the script blocks the parent's Save, Run is dead and its
 *    tooltip carries the very note the parent shows.
 * 7. Run is dead while the script has a syntax error, and while the session is paused at
 *    another block.
 * 8. Save applies the script, keeps the sheet open and goes dead; Close closes it and asks
 *    nothing, and neither reaches the server.
 *
 * A paused repeat substitutes the script alone, so criterion 4 is the not-paused case only.
 *
 * Needs no stack service: every block runs on the WAVE server.
 */

import fs from 'fs'
import path from 'path'
import { randomBytes } from 'node:crypto'

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  importExpectingErrors,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import {
  clearPointerLock,
  clickNodeContextMenuItem,
  configSheet,
  selectEnvironment,
} from '../../helpers/workbench'
import { getLogCopyTexts, getLogTexts, waitForLogText } from '../../helpers/log-reader'
import {
  editPreview,
  openListEditor,
  saveListEditor,
} from '../../helpers/config-sheet'
import { listItem } from '../../helpers/entry-editors'
import { E2E_ENV_NAME } from '../../helpers/config'
import { deleteTest, expandGroup, openConfig, persistedValues } from '../file-picker/picker'
import { consoleEntriesFromCopy, withToken } from '../shell-blocks/shell-helpers'
import {
  closeConfigSheet,
  closeScriptSheet,
  openScriptSheet,
  runButton,
  saveButton,
  stopButton,
  typeScript,
  workflowStatus,
} from './editor-helpers'

/** The console source a Python block's own lines carry. */
const SOURCE = 'Python'

/** The note the element config sheet shows when its form has an error (child-editors.ts). */
const SETTINGS_NOTE = 'Save is disabled: the settings have errors'

const createdTests: string[] = []

/** A fresh per-run token: "py" plus 8 lowercase hex characters. */
function newToken(): string {
  return `py${randomBytes(4).toString('hex')}`
}

function loadFixture(file: string, token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<
    string,
    unknown
  >
  return withToken(raw, token)
}

function envDialog(page: Page): Locator {
  return page.getByTestId('env-selection-dialog')
}

function nodeStatus(page: Page, nodeId: string): Promise<string | null> {
  return page.getByTestId(`workflow-node-${nodeId}`).getAttribute('data-execution-status')
}

/** Open a block's config sheet from its own Configure control: while a run holds the
 *  canvas, a double-click lands as the canvas's own zoom instead. */
async function openConfigFromNode(page: Page, nodeId: string): Promise<Locator> {
  await page
    .locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-configure"]`)
    .click()
  const dialog = configSheet(page)
  await expect(dialog, `config sheet for ${nodeId}`).toBeVisible({ timeout: 15_000 })
  return dialog
}

/** Slide the config sheet off the editor's Run button; the clicks that set a settings
 *  error raise the config in front of the editor's own footer. */
async function slideConfigAside(page: Page, dialog: Locator, sheet: Locator): Promise<void> {
  const box = (await dialog.getByTestId('element-config-sheet-drag-handle').boundingBox())!
  const startX = box.x + Math.min(60, box.width / 3)
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX - 200, startY, { steps: 8 })
  await page.mouse.move(startX - 400, startY, { steps: 8 })
  await page.mouse.up()
  await expect(async () => {
    const config = (await dialog.boundingBox())!
    const run = (await runButton(sheet).boundingBox())!
    expect(config.x + config.width, 'the config sheet cleared the Run button').toBeLessThan(run.x)
  }).toPass({ timeout: 5_000 })
}

/** Hover the disabled Run button's wrapper and read the single accessible copy of its tooltip. */
async function expectRunTooltip(page: Page, sheet: Locator, text: string): Promise<void> {
  await runButton(sheet).locator('xpath=..').hover()
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  await expect(tooltip).toBeVisible({ timeout: 10_000 })
  await expect(tooltip.locator('[role="tooltip"]')).toHaveText(text)
  await page.mouse.move(0, 0)
}

test.describe('V-PLUGIN-PYTHON-RUN: Run from the Python editor (PYRUN-20, PYRUN-21)', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('PYRUN-21: Run executes only this block with the unsaved script and never writes it', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const saved = `print('pyrun' + '-saved-' + '${token}')`
    const draft = `print('pyrun' + '-draft-' + '${token}')`
    const kept = `print('pyrun' + '-kept-' + '${token}')`
    const savedMarker = `pyrun-saved-${token}`
    const draftMarker = `pyrun-draft-${token}`
    const beforeMarker = `pyrun-before-${token}`
    const afterMarker = `pyrun-after-${token}`

    const testId = await importValidateAndNavigate(page, loadFixture('fixture-run.json', token))
    createdTests.push(testId)
    // Expand the console before a sheet can sit over its header.
    await getLogTexts(page)
    await selectEnvironment(page)

    const dialog = await openConfig(page, 'py-main')
    const sheet = await openScriptSheet(page, dialog)

    await test.step('Save is dead on an unchanged draft and Run is live (PYRUN-20)', async () => {
      await expect(saveButton(sheet)).toBeDisabled()
      await expect(runButton(sheet)).toBeEnabled()
    })

    await test.step('Run takes the editor script without asking for an Environment', async () => {
      await typeScript(page, sheet, draft)
      await expect(saveButton(sheet)).toBeEnabled()
      await runButton(sheet).click()
      await expect(envDialog(page), 'the toolbar Environment is used as is').toHaveCount(0)
      await expect(stopButton(sheet), 'Run turns into Stop while its own run is in flight').toBeVisible({
        timeout: 20_000,
      })
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', {
        timeout: 90_000,
      })
    })

    await test.step('only this block ran, and it ran the edited script', async () => {
      await waitForLogText(page, draftMarker, 60_000)
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      const dump = JSON.stringify(entries, null, 2)
      expect(entries.filter((entry) => entry.message === draftMarker), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: draftMarker },
      ])
      for (const absent of [savedMarker, beforeMarker, afterMarker]) {
        expect(
          entries.filter((entry) => entry.message.includes(absent)),
          `${absent} must be on no console line\n${dump}`,
        ).toEqual([])
      }
      expect(await nodeStatus(page, 'py-main')).toBe('success')
      for (const id of ['log-before', 'log-after']) {
        const status = await nodeStatus(page, id)
        expect(
          status === 'success' || status === 'running',
          `${id} must not run for an editor Run, but its status is ${status}`,
        ).toBe(false)
      }
    })

    await test.step('the sheet stays open on its draft and the saved script is untouched', async () => {
      await expect(sheet).toBeVisible()
      await expect(sheet.locator('.cm-content').first()).toHaveText(draft)
      await closeScriptSheet(page, sheet)
      const preview = editPreview(dialog, 'script')
      await expect(preview).toHaveValue(saved)
      await expect(preview).not.toHaveValue(/-draft-/)
      const values = await persistedValues(page.request, testId)
      expect(values['py-main'].script, 'Run never writes the script').toBe(saved)
    })

    await test.step('Save applies the script and keeps the sheet open; Close closes it (PYRUN-20)', async () => {
      const again = await openScriptSheet(page, dialog)
      await typeScript(page, again, kept)
      await expect(saveButton(again)).toBeEnabled()
      await saveButton(again).click()
      await expect(again, 'Save keeps the sheet open').toBeVisible()
      await expect(saveButton(again), 'Save goes dead until the draft changes again').toBeDisabled()
      await expect(editPreview(dialog, 'script')).toHaveValue(kept)
      await again.getByTestId('value-editor-cancel-button').click()
      await expect(again).toBeHidden({ timeout: 10_000 })
      await expect(
        page.getByTestId('value-editor-unsaved-dialog'),
        'Close right after Save asks nothing',
      ).toHaveCount(0)
      const values = await persistedValues(page.request, testId)
      expect(values['py-main'].script, 'the sheet Save never reaches the server').toBe(saved)
    })

    await closeConfigSheet(page, dialog)
  })

  test('PYRUN-21: Run asks for an Environment only when none is selected and adopts the one picked', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const first = `print('pyrun' + '-envask-' + '${token}')`
    const second = `print('pyrun' + '-envkept-' + '${token}')`
    const firstMarker = `pyrun-envask-${token}`
    const secondMarker = `pyrun-envkept-${token}`
    const environmentId = await resolveEnvironmentId(request)

    const testId = await importValidateAndNavigate(page, loadFixture('fixture-run.json', token))
    createdTests.push(testId)
    await getLogTexts(page)
    await expect(page.getByTestId('environment-selector')).toHaveText('Select Environment')

    const dialog = await openConfig(page, 'py-main')
    const sheet = await openScriptSheet(page, dialog)

    await test.step('with no Environment selected Run asks for one', async () => {
      await typeScript(page, sheet, first)
      await runButton(sheet).click()
      const chooser = envDialog(page)
      await expect(chooser).toBeVisible({ timeout: 10_000 })
      await expect(chooser).toContainText('Run Test')
      await chooser.getByTestId(`env-dialog-${environmentId}`).click()
      await chooser.getByTestId('env-dialog-confirm').click()
      await expect(chooser).toBeHidden({ timeout: 10_000 })
      await clearPointerLock(page)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', {
        timeout: 90_000,
      })
      await waitForLogText(page, firstMarker, 60_000)
    })

    await test.step('the Environment picked there becomes the toolbar selection', async () => {
      await expect(page.getByTestId('environment-selector')).toHaveText(E2E_ENV_NAME)
    })

    await test.step('the next Run uses it and asks nothing', async () => {
      await typeScript(page, sheet, second)
      await expect(runButton(sheet)).toBeEnabled({ timeout: 30_000 })
      await runButton(sheet).click()
      await expect(envDialog(page)).toHaveCount(0)
      await waitForLogText(page, secondMarker, 60_000)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', {
        timeout: 60_000,
      })
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      expect(
        entries.filter((entry) => entry.message === secondMarker),
        JSON.stringify(entries, null, 2),
      ).toEqual([{ level: 'INFO', source: SOURCE, message: secondMarker }])
    })

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
  })

  test('PYRUN-21: a Run at a paused block repeats that block and leaves the session paused', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const token = newToken()
    const draftA = `print('pyrun' + '-repeat1-' + '${token}')`
    const draftB = `print('pyrun' + '-repeat2-' + '${token}')`
    const markerA = `pyrun-repeat1-${token}`
    const markerB = `pyrun-repeat2-${token}`
    const savedMarker = `pyrun-saved-${token}`
    const beforeMarker = `pyrun-before-${token}`
    const afterMarker = `pyrun-after-${token}`

    const testId = await importValidateAndNavigate(page, loadFixture('fixture-run.json', token))
    createdTests.push(testId)
    await getLogTexts(page)

    await clickNodeContextMenuItem(page, 'log-before', 'Toggle Breakpoint')
    await clickNodeContextMenuItem(page, 'py-main', 'Toggle Breakpoint')
    await selectEnvironment(page)

    // The config sheet freezes its fields while a run is in flight, so the editor is
    // opened first and stays open across the pause, as an author working in it would.
    const dialog = await openConfigFromNode(page, 'py-main')
    const sheet = await openScriptSheet(page, dialog)

    await page.getByTestId('debug-button').click()
    await expect(workflowStatus(page)).toHaveAttribute('data-status', 'paused', { timeout: 60_000 })
    await expect(page.getByTestId('workflow-node-log-before')).toHaveAttribute(
      'data-paused',
      'true',
    )

    await test.step('paused at another block, Run is dead', async () => {
      await expect(runButton(sheet)).toBeDisabled()
    })

    await page.getByTestId('action-continue-button').click()
    await expect(page.getByTestId('workflow-node-py-main')).toHaveAttribute('data-paused', 'true', {
      timeout: 60_000,
    })
    await expect(workflowStatus(page)).toHaveAttribute('data-status', 'paused')

    await test.step('Run repeats this block with the editor script and stays paused on it', async () => {
      const why = await runButton(sheet).evaluate((el) => el.outerHTML)
      await expect(runButton(sheet), `Run at a paused block. ${why}`).toBeEnabled({
        timeout: 30_000,
      })
      await typeScript(page, sheet, draftA)
      await runButton(sheet).click()
      await waitForLogText(page, markerA, 90_000)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'paused')
      await expect(page.getByTestId('workflow-node-py-main')).toHaveAttribute('data-paused', 'true')
    })

    await test.step('a second Run is another repeat, not a new run', async () => {
      await typeScript(page, sheet, draftB)
      await expect(runButton(sheet)).toBeEnabled({ timeout: 60_000 })
      await runButton(sheet).click()
      await waitForLogText(page, markerB, 90_000)
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      const dump = JSON.stringify(entries, null, 2)
      expect(entries.filter((entry) => entry.message === markerA), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: markerA },
      ])
      expect(entries.filter((entry) => entry.message === markerB), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: markerB },
      ])
      expect(
        entries.filter((entry) => entry.message.includes(beforeMarker)).length,
        `the upstream Log must stay at one entry (no restart)\n${dump}`,
      ).toBe(1)
      expect(
        entries.filter((entry) => entry.message.includes(savedMarker)),
        `the saved script never ran\n${dump}`,
      ).toEqual([])
      expect(
        entries.filter((entry) => entry.message.includes(afterMarker)),
        `the run never moved past this block\n${dump}`,
      ).toEqual([])
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'paused')
      await expect(page.getByTestId('workflow-node-py-main')).toHaveAttribute('data-paused', 'true')
    })

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
    await page.getByTestId('action-continue-button').click()
    await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', { timeout: 90_000 })
  })

  test("PYRUN-21: Run sends the block's whole unsaved configuration, not the script alone", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const savedArg = `pyrun-savedarg-${token}`
    const draftArg = `pyrun-draftarg-${token}`
    const marker = `pyarg=${draftArg}`

    const testId = await importValidateAndNavigate(page, loadFixture('fixture-args.json', token))
    createdTests.push(testId)
    await getLogTexts(page)
    await selectEnvironment(page)

    const dialog = await openConfig(page, 'py-args')
    const line = editPreview(dialog, 'arguments')
    await expect(line).toHaveValue(`["${savedArg}"]`)

    await test.step('an Arguments item is edited in the list editor and applied to the form, never saved', async () => {
      const listEditor = await openListEditor(page, dialog, 'arguments')
      const item = listItem(listEditor, 0).valueInput
      await expect(item).toHaveValue(savedArg)
      await item.fill(draftArg)
      await saveListEditor(listEditor)
      await expect(line).toHaveValue(`["${draftArg}"]`)
    })

    const sheet = await openScriptSheet(page, dialog)

    await test.step('Run carries the unsaved Arguments row into the run', async () => {
      await runButton(sheet).click()
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', {
        timeout: 90_000,
      })
      await waitForLogText(page, marker, 60_000)
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      const dump = JSON.stringify(entries, null, 2)
      expect(entries.filter((entry) => entry.message === marker), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: marker },
      ])
      expect(
        entries.filter((entry) => entry.message.includes(savedArg)),
        `the saved argument must be on no console line\n${dump}`,
      ).toEqual([])
    })

    await test.step('the saved Arguments row is untouched on the server', async () => {
      const values = await persistedValues(page.request, testId)
      expect(values['py-args'].arguments).toEqual([{ value: savedArg }])
    })

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
  })

  test("PYRUN-21: another block's error never refuses Run; a finding on this block does", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const okMarker = `pyrun-ok-${token}`
    const badMarker = `pyrun-bad-${token}`

    const imported = await importExpectingErrors(
      page,
      loadFixture('fixture-other-error.json', token),
      { context: 'run' },
    )
    createdTests.push(imported.testId)
    const owners = imported.errors.map((error) => String(error.node_id))
    const findings = JSON.stringify(imported.errors, null, 2)
    expect(owners, findings).toContain('log-ghost')
    expect(owners, findings).toContain('py-bad')

    await getLogTexts(page)
    await selectEnvironment(page)

    await test.step('a finding on this block refuses its Run', async () => {
      const dialog = await openConfig(page, 'py-bad')
      const sheet = await openScriptSheet(page, dialog)
      await expect(runButton(sheet), 'the form is fine, so only the finding can refuse').toBeEnabled()
      await runButton(sheet).click()
      const refusal = page.getByTestId('validation-error-dialog')
      await expect(refusal).toBeVisible({ timeout: 15_000 })
      await expect(refusal).toContainText('pyrun_missing')
      await page.getByTestId('validation-close-btn').click()
      await expect(refusal).toBeHidden({ timeout: 10_000 })
      await expect(workflowStatus(page), 'nothing started').toHaveAttribute('data-status', 'idle')
      await closeScriptSheet(page, sheet)
      await closeConfigSheet(page, dialog)
    })

    await test.step("the other blocks' errors do not refuse this one", async () => {
      const dialog = await openConfig(page, 'py-ok')
      const sheet = await openScriptSheet(page, dialog)
      await runButton(sheet).click()
      await expect(page.getByTestId('validation-error-dialog')).toHaveCount(0)
      await expect(workflowStatus(page)).toHaveAttribute('data-status', 'passed', {
        timeout: 90_000,
      })
      await waitForLogText(page, okMarker, 60_000)
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      const dump = JSON.stringify(entries, null, 2)
      expect(entries.filter((entry) => entry.message === okMarker), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: okMarker },
      ])
      expect(entries.filter((entry) => entry.message.includes(badMarker)), dump).toEqual([])
      expect(await nodeStatus(page, 'py-ok')).toBe('success')
      for (const id of ['log-ghost', 'py-bad']) {
        const status = await nodeStatus(page, id)
        expect(
          status === 'success' || status === 'running',
          `${id} must not run for an editor Run, but its status is ${status}`,
        ).toBe(false)
      }
      await closeScriptSheet(page, sheet)
      await closeConfigSheet(page, dialog)
    })
  })

  test("PYRUN-21: Run is dead on a syntax error and on a settings error, under the parent's own note", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const saved = `print('pyrun' + '-saved-' + '${token}')`
    const broken = 'x = = 1'

    const testId = await importValidateAndNavigate(page, loadFixture('fixture-run.json', token))
    createdTests.push(testId)
    await getLogTexts(page)
    await selectEnvironment(page)

    const dialog = await openConfig(page, 'py-main')
    const sheet = await openScriptSheet(page, dialog)

    await test.step('a syntax error kills Run and names its line', async () => {
      await expect(runButton(sheet)).toBeEnabled()
      await typeScript(page, sheet, broken)
      await expect(runButton(sheet)).toBeDisabled({ timeout: 15_000 })
      const strip = sheet.getByTestId('value-editor-validation')
      await expect(strip).toHaveAttribute('role', 'alert')
      await expect(strip).toHaveText(/^Line 1: /)
      // PYRUN-13: a syntax error never blocks Save, only Run.
      await expect(saveButton(sheet)).toBeEnabled()
    })

    await test.step('Run comes back once the script parses again', async () => {
      await typeScript(page, sheet, saved)
      await expect(runButton(sheet)).toBeEnabled({ timeout: 15_000 })
      await expect(sheet.getByTestId('value-editor-validation')).toHaveCount(0)
    })

    await test.step("a settings error kills Run under the parent's own note", async () => {
      await expandGroup(dialog, 'Stop on Pattern')
      await dialog.getByRole('checkbox', { name: 'Stop on pattern' }).click()
      await expect(dialog.getByTestId('save-blocked-note')).toHaveText(SETTINGS_NOTE)
      await expect(dialog.getByRole('button', { name: /^Save$/ }).last()).toBeDisabled()
      await expect(runButton(sheet)).toBeDisabled()
      await slideConfigAside(page, dialog, sheet)
      await expectRunTooltip(page, sheet, SETTINGS_NOTE)
    })

    await test.step('clearing the settings error brings Run back', async () => {
      await dialog.getByRole('checkbox', { name: 'Stop on pattern' }).click()
      await expect(dialog.getByTestId('save-blocked-note')).toHaveCount(0)
      await expect(runButton(sheet)).toBeEnabled()
    })

    await closeScriptSheet(page, sheet)
    await closeConfigSheet(page, dialog)
  })
})
