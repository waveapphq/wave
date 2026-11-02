/**
 * V-FILE-PICKER-FUNCTIONAL: the file-reference picker behind every Browse button.
 *
 * Wireframe: N/A (the picker's look is covered by the visual suite)
 * Design Decisions: TDATA-8, TDATA-9, TDATA-10
 * REQ: REQ-3.4.2.2, REQ-3.4.3.1, REQ-3.4.3.2, REQ-3.4.1.10
 *
 * Four tests, three fixtures. Every row starts on a placeholder nobody picked,
 * so a leg that fails to write its reference fails the run rather than passing
 * on a seeded value, and every leg ends on the value the server persisted - or
 * on what the run resolved from it. The Reference line is read in its split
 * form: the fixed scheme of the tab in front, then the path under it.
 *
 * Pass Criteria:
 *  FP-1  File I/O Read Path opens in `file` mode on the Artifacts tab, with
 *        the path of the artifact the row holds; on Test Data the path starts
 *        empty, a folder answers nothing, on a click or a double click;
 *        picking a file stores `testdata://inputs/greeting.txt`, and the run's
 *        Read returns the bytes the spec uploaded.
 *  FP-2  File I/O Copy Source opens in `file-or-folder` mode; Select is dead
 *        while the path is empty and live for a folder and for a file alike;
 *        emptying the path leaves the scheme in place; the stored Source is the
 *        file that was picked and the run copies it into the run's artifacts.
 *  FP-3  File I/O Copy Destination opens in `save-as` mode with the Name preset
 *        to the Source's own name; renaming recomposes the Reference, and the
 *        run writes the artifact under the composed name.
 *  FP-4  File I/O List Path opens in `folder` mode on the Artifacts tab: on
 *        Test Data file rows render muted, aria-disabled and outside the tree, a
 *        click on one changes nothing, and only a folder can be chosen; the run
 *        lists the picked folder.
 *  FP-5  File I/O Write Path opens in `save-as` mode with no source tabs and the
 *        session's artifacts as the only source under `artifact://`; an empty
 *        Name leaves Select dead; the run writes to the composed artifact.
 *  FP-6  File I/O Move Source is artifacts-only: the picker offers no Test Data
 *        tab at all, the path typed under `artifact://` is accepted, and the run
 *        moves the artifact Copy wrote.
 *  FP-7  Excel Workbook picks a workbook out of Test Data on a double-click and
 *        composes its written workbook in save-as; HTTP File Source picks the
 *        uploaded payload and HTTP File Path takes a path typed under
 *        `artifact://`; the run sends the picked file and saves the reply where
 *        the picker said.
 *  FP-8  Browse is withheld on an expression row, on the pod-side K8s Copy rows
 *        and on every row inside a Remote Execution body, and returns on the
 *        same row the moment expression mode is switched off.
 *  FP-9  K8s Copy Source Path (file-or-folder) and Target Path (save-as) store
 *        the references the picker composed.
 *  FP-12 The picker opens on the tab of the scheme the row holds: Browse on a
 *        row holding `/srv/in.csv` opens with `testdata://` and an empty path,
 *        Select disabled, and after Cancel the row still holds `/srv/in.csv`; a
 *        row holding `artifact://x` opens on the Artifacts tab with path `x`.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/file-picker/v-file-picker-functional.spec.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { SWITCH_TO_PLAIN_TITLE, switchWarning } from '../../helpers/value-field'
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
  persistedValues,
  saveConfig,
  saveWorkbench,
  setOperation,
  type SeedFile,
} from './picker'

// --- what the spec uploads and what it expects back ------------------------

/** The path under `artifact://` every File I/O path row is imported with. */
const SEED_PATH = 'seed-not-picked.txt'
/** A row value under neither scheme (FP-12). */
const OUTSIDE_BOTH = '/srv/in.csv'

const GREETING = 'greeting picked through the file picker'
const NOTES = 'a second file so the picked folder lists two entries'
/** Must match the `content` the fixture carries on the Write Block. */
const WRITE_CONTENT = 'written to the artifact the save-as picker composed'
const PAYLOAD = '{"picked":"http-file-source"}'

/** LibreOffice output the backend reader tests use; its People sheet has 3 rows. */
const WORKBOOK = fs.readFileSync(
  path.resolve(__dirname, '../../../../backend/tests/plugins/excel_parser/fixtures/sample_workbook.xlsx'),
)

const FILEIO_FILES: SeedFile[] = [
  { folder: 'inputs', name: 'greeting.txt', body: Buffer.from(GREETING, 'utf-8') },
  { folder: 'inputs', name: 'notes.txt', body: Buffer.from(NOTES, 'utf-8') },
]
const PLUGIN_FILES: SeedFile[] = [
  { folder: '', name: 'payload.json', body: Buffer.from(PAYLOAD, 'utf-8') },
  { folder: 'books', name: 'sample_workbook.xlsx', body: WORKBOOK },
]

const FILEIO_BOOKEND = 'file-picker-fileio-done'
const PLUGINS_BOOKEND = 'file-picker-plugins-done'

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<string, unknown>
}

/** The fixture with some Blocks' stored values replaced before import. */
function withValues(
  fixture: Record<string, unknown>,
  values: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const workflow = fixture.workflow as {
    nodes: Array<{ id: string; data: { config: { values: Record<string, unknown> } } }>
  }
  for (const node of workflow.nodes) Object.assign(node.data.config.values, values[node.id] ?? {})
  return fixture
}

/** Every session artifact the run left, by path. */
async function sessionArtifacts(page: Page): Promise<Map<string, number>> {
  const response = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
  expect(response.ok(), `GET /workbench/session/artifacts answered ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items: Array<{ path: string; size_bytes: number }> }
  return new Map(body.items.map((item) => [item.path, item.size_bytes]))
}

/** One session artifact's bytes. */
async function artifactText(page: Page, artifact: string): Promise<string> {
  const response = await page.request.get(
    `${BACKEND_URL}/workbench/session/artifacts/content/${artifact}`,
  )
  expect(response.ok(), `GET artifacts/content/${artifact} answered ${response.status()}`).toBeTruthy()
  return response.text()
}

/** The console line a marker Block stamped. */
function expectLine(logs: readonly string[], line: string): void {
  expect(logs.includes(line), `the run never printed "${line}".\n${logs.join('\n')}`).toBeTruthy()
}

const createdTests: string[] = []

test.describe('V-FILE-PICKER: Browse writes a reference the run resolves', () => {
  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterEach(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  // -------------------------------------------------------------------------
  // FP-1 .. FP-6: the File I/O family, one Test, one run.
  // -------------------------------------------------------------------------
  test('the File I/O path rows are filled through Browse and the run resolves them', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    const testId = await importWithTestData(page, loadFixture('fixture.json'), FILEIO_FILES)
    createdTests.push(testId)

    await test.step('FP-1: Read Path picks a Test Data file in file mode', async () => {
      const dialog = await openConfig(page, 'fio-read')
      const browse = dialog.getByTestId('param-browse-path')
      await expect(browse).toHaveAttribute('aria-label', 'Browse files for Path')
      const picker = await openPicker(page, dialog, 'path', 'file')
      // The row holds an artifact, so the picker opens on Artifacts with its path (TDATA-9).
      await expect(picker.artifactsTab).toHaveAttribute('aria-pressed', 'true')
      await expect(picker.testDataTab).toHaveAttribute('aria-pressed', 'false')
      await expectReference(picker, 'artifact://', SEED_PATH)

      // Test Data is the source a file row is picked from, with a path of its own.
      await picker.testDataTab.click()
      await expect(picker.testDataTab).toHaveAttribute('aria-pressed', 'true')
      await expectReference(picker, 'testdata://', '')
      await expect(picker.select, 'the Test Data tab holds no path yet').toBeDisabled()

      await picker.file('inputs/greeting.txt').click()
      await expectReference(picker, 'testdata://', 'inputs/greeting.txt')

      // A folder cannot answer a field that asked for a file, by any gesture:
      // a double click chooses only where a single click selects.
      await picker.folder('inputs').dblclick()
      await expectReference(picker, 'testdata://', 'inputs/greeting.txt', 'a folder answers nothing here')
      await expect(picker.sheet, 'and the picker stays open').toBeVisible()
      await confirmPicker(picker)

      await expectRowValue(dialog, 'path', 'testdata://inputs/greeting.txt')
      await saveConfig(dialog)
    })

    await test.step('FP-2: Copy Source follows the selection in file-or-folder mode', async () => {
      const dialog = await openConfig(page, 'fio-copy')
      // Paired rows: choosing Copy swaps the single Path row for Source + Destination.
      await expect(dialog.locator('[data-testid="param-row-path"]')).toBeVisible()
      await setOperation(page, dialog, 'Copy')
      await expect(dialog.locator('[data-testid="param-row-path"]')).toHaveCount(0)
      await expect(dialog.locator('[data-testid="param-row-source"]')).toBeVisible()

      const picker = await openPicker(page, dialog, 'source', 'file-or-folder')
      await expectReference(picker, 'testdata://', '')
      await expect(picker.select, 'nothing chosen yet, so Select is dead').toBeDisabled()

      await picker.folder('inputs').click()
      await expectReference(picker, 'testdata://', 'inputs')
      await expect(picker.select, 'a folder is a valid choice in this mode').toBeEnabled()

      await picker.file('inputs/greeting.txt').click()
      await expectReference(picker, 'testdata://', 'inputs/greeting.txt')

      await picker.reference.fill('')
      await expect(picker.select, 'an emptied path kills Select again').toBeDisabled()
      await expectReference(picker, 'testdata://', '', 'the scheme is not typed, so it stays')
      await picker.file('inputs/greeting.txt').click()
      await expectReference(picker, 'testdata://', 'inputs/greeting.txt')
      await confirmPicker(picker)
      await expectRowValue(dialog, 'source', 'testdata://inputs/greeting.txt')

      await test.step('FP-3: Destination opens on the Source name and recomposes', async () => {
        const destination = await openPicker(page, dialog, 'destination', 'save-as')
        await expect(destination.testDataTab, 'save-as reads the artifacts only').toHaveCount(0)
        await expect(destination.artifactsTab).toHaveCount(0)
        await expect(destination.name, 'the Name opens on the Source file name').toHaveValue(
          'greeting.txt',
        )
        await expectReference(destination, 'artifact://', 'greeting.txt')

        await destination.name.fill('')
        await expect(destination.select, 'save-as needs a name').toBeDisabled()
        await destination.name.fill('copied-greeting.txt')
        await expectReference(destination, 'artifact://', 'copied-greeting.txt')
        await confirmPicker(destination)
        await expectRowValue(dialog, 'destination', 'artifact://copied-greeting.txt')
      })

      await saveConfig(dialog)
    })

    await test.step('FP-4: List Path shows files muted and takes only a folder', async () => {
      const dialog = await openConfig(page, 'fio-list')
      const picker = await openPicker(page, dialog, 'path', 'folder')
      await expect(picker.artifactsTab).toHaveAttribute('aria-pressed', 'true')
      await expectReference(picker, 'artifact://', SEED_PATH)
      await picker.testDataTab.click()
      await expectReference(picker, 'testdata://', '')
      await expect(picker.select).toBeDisabled()

      const mutedFile = picker.file('inputs/greeting.txt')
      await expect(mutedFile).toHaveAttribute('data-muted', 'true')
      await expect(mutedFile).toHaveAttribute('aria-disabled', 'true')
      await expect(mutedFile, 'a muted row is outside the tree').not.toHaveAttribute(
        'role',
        'treeitem',
      )

      await picker.folder('inputs').click()
      await expectReference(picker, 'testdata://', 'inputs')
      // force: the row is aria-disabled; the point is that a real click reaches
      // it and still changes nothing.
      await mutedFile.click({ force: true })
      await expectReference(picker, 'testdata://', 'inputs', 'a muted file answers nothing')
      await confirmPicker(picker)

      await expectRowValue(dialog, 'path', 'testdata://inputs')
      await saveConfig(dialog)
    })

    await test.step('FP-5: Write Path composes an artifact reference', async () => {
      const dialog = await openConfig(page, 'fio-write')
      const picker = await openPicker(page, dialog, 'path', 'save-as')
      await expect(picker.testDataTab).toHaveCount(0)
      await expect(picker.artifactsEmpty).toHaveText(
        'Files this session wrote appear here. Type a path an earlier block writes.',
      )

      await expectReference(picker, 'artifact://', SEED_PATH)
      await picker.name.fill('')
      await expect(picker.select).toBeDisabled()
      await picker.name.fill('picked-write.txt')
      await expectReference(picker, 'artifact://', 'picked-write.txt')
      await confirmPicker(picker)

      await expectRowValue(dialog, 'path', 'artifact://picked-write.txt')
      await saveConfig(dialog)
    })

    await test.step('FP-6: Move Source offers artifacts only', async () => {
      const dialog = await openConfig(page, 'fio-move')
      const source = await openPicker(page, dialog, 'source', 'file-or-folder')
      await expect(source.testDataTab, 'Move never reads test data').toHaveCount(0)
      await expect(source.artifactsTab).toHaveCount(0)
      await expect(source.sheet).toContainText("Files in this session's artifacts")
      await expectReference(source, 'artifact://', SEED_PATH)
      await source.reference.fill('copied-greeting.txt')
      await expectReference(source, 'artifact://', 'copied-greeting.txt')
      await confirmPicker(source)

      const destination = await openPicker(page, dialog, 'destination', 'save-as')
      await destination.name.fill('moved-greeting.txt')
      await expectReference(destination, 'artifact://', 'moved-greeting.txt')
      await confirmPicker(destination)

      await expectRowValue(dialog, 'source', 'artifact://copied-greeting.txt')
      await expectRowValue(dialog, 'destination', 'artifact://moved-greeting.txt')
      await saveConfig(dialog)
    })

    await saveWorkbench(page)

    await test.step('every picked reference is what the server stored', async () => {
      const values = await persistedValues(request, testId)
      expect(values['fio-read'].path).toBe('testdata://inputs/greeting.txt')
      expect(values['fio-copy'].operation).toBe('copy')
      expect(
        values['fio-copy'].path,
        'the Path row was swapped out, so its value went with it',
      ).toBeUndefined()
      expect(values['fio-copy'].source).toBe('testdata://inputs/greeting.txt')
      expect(values['fio-copy'].destination).toBe('artifact://copied-greeting.txt')
      expect(values['fio-list'].path).toBe('testdata://inputs')
      expect(values['fio-write'].path).toBe('artifact://picked-write.txt')
      expect(values['fio-move'].source).toBe('artifact://copied-greeting.txt')
      expect(values['fio-move'].destination).toBe('artifact://moved-greeting.txt')
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, FILEIO_BOOKEND, 120_000)

    await test.step('the run resolved every reference the picker wrote', async () => {
      await expectNodesSuccess(page, ['fio-read', 'fio-copy', 'fio-list', 'fio-write', 'fio-move'])
      expectLine(logs, `picked-read=${GREETING}`)
      expectLine(logs, 'picked-list=2')
    })

    await test.step('the artifacts hold what the picked write and move produced', async () => {
      const artifacts = await sessionArtifacts(page)
      expect(
        [...artifacts.keys()],
        `expected the composed write and the move target. Got: ${JSON.stringify([...artifacts.keys()])}`,
      ).toEqual(expect.arrayContaining(['picked-write.txt', 'moved-greeting.txt']))
      expect(
        artifacts.has('copied-greeting.txt'),
        'the Move consumed the artifact the Copy wrote',
      ).toBe(false)
      expect(await artifactText(page, 'moved-greeting.txt')).toBe(GREETING)
      expect(await artifactText(page, 'picked-write.txt')).toBe(WRITE_CONTENT)
    })
  })

  // -------------------------------------------------------------------------
  // FP-7: Excel and HTTP, one Test, one run.
  // -------------------------------------------------------------------------
  test('the Excel and HTTP file rows are filled through Browse and the run resolves them', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    const testId = await importWithTestData(page, loadFixture('fixture-plugins.json'), PLUGIN_FILES, {
      injectHttp: true,
    })
    createdTests.push(testId)

    await test.step('FP-7: Excel Workbook read takes a Test Data file on a double-click', async () => {
      const dialog = await openConfig(page, 'xl-read')
      const picker = await openPicker(page, dialog, 'workbook', 'file')
      // The row holds an artifact, so the workbook comes off the other tab.
      await expect(picker.artifactsTab).toHaveAttribute('aria-pressed', 'true')
      await picker.testDataTab.click()
      // A double-click chooses and closes in one gesture.
      await picker.file('books/sample_workbook.xlsx').dblclick()
      await expect(picker.sheet).toBeHidden({ timeout: 10_000 })
      await expectRowValue(dialog, 'workbook', 'testdata://books/sample_workbook.xlsx')
      await saveConfig(dialog)
    })

    await test.step('FP-7: Excel Workbook write composes an artifact reference', async () => {
      const dialog = await openConfig(page, 'xl-write')
      const picker = await openPicker(page, dialog, 'workbook', 'save-as')
      await expect(picker.testDataTab).toHaveCount(0)
      await picker.name.fill('picked-book.xlsx')
      await expectReference(picker, 'artifact://', 'picked-book.xlsx')
      await confirmPicker(picker)
      await expectRowValue(dialog, 'workbook', 'artifact://picked-book.xlsx')
      await saveConfig(dialog)
    })

    await test.step('FP-7: HTTP File Source and File Path are picked and composed', async () => {
      const dialog = await openConfig(page, 'http-echo')

      await expandGroup(dialog, 'Body')
      const source = await openPicker(page, dialog, 'file_source', 'file')
      await source.testDataTab.click()
      await source.file('payload.json').click()
      await expectReference(source, 'testdata://', 'payload.json')
      await confirmPicker(source)
      await expectRowValue(dialog, 'file_source', 'testdata://payload.json')

      await expandGroup(dialog, 'Response')
      const target = await openPicker(page, dialog, 'file_path', 'save-as')
      await target.reference.fill('downloads/echo.json')
      // A typed path re-derives the folder and the Name it composes from.
      await expectReference(target, 'artifact://', 'downloads/echo.json')
      await expect(target.name).toHaveValue('echo.json')
      await confirmPicker(target)
      await expectRowValue(dialog, 'file_path', 'artifact://downloads/echo.json')

      await saveConfig(dialog)
    })

    await saveWorkbench(page)

    await test.step('every picked reference is what the server stored', async () => {
      const values = await persistedValues(request, testId)
      expect(values['xl-read'].workbook).toBe('testdata://books/sample_workbook.xlsx')
      expect(values['xl-write'].workbook).toBe('artifact://picked-book.xlsx')
      expect(values['http-echo'].file_source).toBe('testdata://payload.json')
      expect(values['http-echo'].file_path).toBe('artifact://downloads/echo.json')
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, PLUGINS_BOOKEND, 120_000)

    await test.step('the run read the picked workbook and saved the reply where the picker said', async () => {
      await expectNodesSuccess(page, ['xl-read', 'xl-write', 'http-echo'])
      // The People sheet of the checked-in workbook carries three rows.
      expectLine(logs, 'picked-xl-rows=3')
      expect(
        logs.some((line) => line.startsWith('picked-dl=artifact://downloads/echo.json bytes=')),
        `the download reported the reference the picker composed.\n${logs.join('\n')}`,
      ).toBeTruthy()

      const artifacts = await sessionArtifacts(page)
      expect(
        [...artifacts.keys()],
        `Got: ${JSON.stringify([...artifacts.keys()])}`,
      ).toEqual(expect.arrayContaining(['picked-book.xlsx', 'downloads/echo.json']))
      expect(artifacts.get('picked-book.xlsx')).toBeGreaterThan(0)

      const echoed = JSON.parse(await artifactText(page, 'downloads/echo.json')) as { body?: string }
      expect(echoed.body, 'the request body was the file the picker chose').toBe(PAYLOAD)
    })
  })

  // -------------------------------------------------------------------------
  // FP-8 / FP-9: where Browse is withheld, and the two K8s Copy WAVE-side rows.
  // -------------------------------------------------------------------------
  test('Browse is withheld where a WAVE-side reference cannot be used', async ({ page, request }) => {
    test.setTimeout(300_000)
    const testId = await importWithTestData(page, loadFixture('fixture-gating.json'), FILEIO_FILES, {
      injectSsh: true,
    })
    createdTests.push(testId)

    const expressionToggle = (dialog: Locator, name: string): Locator =>
      dialog.locator(`[data-testid="param-row-${name}"] [data-testid="expression-toggle"]`)

    await test.step('FP-8: an expression row has no Browse until expression mode is off', async () => {
      const dialog = await openConfig(page, 'fio-expr')
      await expect(expressionToggle(dialog, 'path')).toHaveAttribute('aria-pressed', 'true')
      await expect(
        dialog.getByTestId('param-browse-path'),
        'an expression names a variable, not a file',
      ).toHaveCount(0)

      await expressionToggle(dialog, 'path').click()
      // The row holds an expression, so switching back asks first (FIELD-7).
      await expect(switchWarning(page)).toContainText(SWITCH_TO_PLAIN_TITLE)
      await switchWarning(page).getByRole('button', { name: /^Clear( & Default)?$/ }).click()
      await expect(switchWarning(page)).toHaveCount(0)
      await expect(expressionToggle(dialog, 'path')).toHaveAttribute('aria-pressed', 'false')
      await expect(dialog.getByTestId('param-browse-path')).toBeVisible()

      const picker = await openPicker(page, dialog, 'path', 'file')
      await picker.file('inputs/greeting.txt').click()
      await confirmPicker(picker)
      await expectRowValue(dialog, 'path', 'testdata://inputs/greeting.txt')
      await saveConfig(dialog)
    })

    await test.step('FP-9: K8s Copy offers Browse on the WAVE side only', async () => {
      const push = await openConfig(page, 'k8s-push')
      await expect(
        push.getByTestId('param-browse-target_path'),
        'To Pod puts the target inside the pod, where a WAVE reference means nothing',
      ).toHaveCount(0)
      const source = await openPicker(page, push, 'source_path', 'file-or-folder')
      await source.testDataTab.click()
      await source.file('inputs/greeting.txt').click()
      await expectReference(source, 'testdata://', 'inputs/greeting.txt')
      await confirmPicker(source)
      await expectRowValue(push, 'source_path', 'testdata://inputs/greeting.txt')
      await saveConfig(push)

      const pull = await openConfig(page, 'k8s-pull')
      await expect(
        pull.getByTestId('param-browse-source_path'),
        'From Pod reads a pod path, not a WAVE reference',
      ).toHaveCount(0)
      const target = await openPicker(page, pull, 'target_path', 'save-as')
      await target.name.fill('pulled-greeting.txt')
      await expectReference(target, 'artifact://', 'pulled-greeting.txt')
      await confirmPicker(target)
      await expectRowValue(pull, 'target_path', 'artifact://pulled-greeting.txt')
      await saveConfig(pull)
    })

    await test.step('FP-8: a Block inside a Remote Execution body has no Browse', async () => {
      const inside = await openConfig(page, 'fio-inside')
      await expect(
        inside.getByTestId('param-browse-path'),
        'inside the body the path belongs to the execution host',
      ).toHaveCount(0)
      // The row is otherwise a normal editable row: only Browse is withheld.
      await expect(expressionToggle(inside, 'path')).toBeVisible()
      await expectRowValue(inside, 'path', '/tmp/wave-e2e-picker/inside.txt')
      await closeConfig(inside)
    })

    await saveWorkbench(page)

    await test.step('what was picked persisted, and what was withheld stayed as imported', async () => {
      const nodes = await persistedNodes(request, testId)
      expect(nodes['fio-expr'].config.values.path).toBe('testdata://inputs/greeting.txt')
      expect(
        nodes['fio-expr'].expressionFields,
        'the row left expression mode when the toggle went off',
      ).not.toContain('path')
      expect(nodes['k8s-push'].config.values.source_path).toBe('testdata://inputs/greeting.txt')
      expect(nodes['k8s-push'].config.values.target_path).toBe('/tmp/wave-e2e-picker/pushed.bin')
      expect(nodes['k8s-pull'].config.values.target_path).toBe('artifact://pulled-greeting.txt')
      expect(nodes['k8s-pull'].config.values.source_path).toBe('/tmp/wave-e2e-picker/pushed.bin')
      expect(nodes['fio-inside'].config.values.path).toBe('/tmp/wave-e2e-picker/inside.txt')
    })
  })

  // -------------------------------------------------------------------------
  // FP-12: the picker opens on the tab of the scheme the row holds.
  // -------------------------------------------------------------------------
  test('Browse opens on the scheme the row holds and Cancel leaves the row as it was', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const fixture = withValues(loadFixture('fixture.json'), {
      'fio-read': { path: OUTSIDE_BOTH },
      'fio-list': { path: 'artifact://x' },
    })
    const testId = await importWithTestData(page, fixture, [])
    createdTests.push(testId)

    await test.step('FP-12: a row under neither scheme opens on Test Data with an empty path', async () => {
      const dialog = await openConfig(page, 'fio-read')
      await expectRowValue(dialog, 'path', OUTSIDE_BOTH)
      const picker = await openPicker(page, dialog, 'path', 'file')
      await expect(picker.testDataTab).toHaveAttribute('aria-pressed', 'true')
      await expect(picker.artifactsTab).toHaveAttribute('aria-pressed', 'false')
      await expectReference(picker, 'testdata://', '')
      await expect(picker.select, 'an empty path has nothing to select').toBeDisabled()

      await picker.cancel.click()
      await expect(picker.sheet).toBeHidden({ timeout: 10_000 })
      await expectRowValue(dialog, 'path', OUTSIDE_BOTH)
      await closeConfig(dialog)
    })

    await test.step('FP-12: a row holding an artifact opens on Artifacts with its path', async () => {
      const dialog = await openConfig(page, 'fio-list')
      const picker = await openPicker(page, dialog, 'path', 'folder')
      await expect(picker.artifactsTab).toHaveAttribute('aria-pressed', 'true')
      await expect(picker.testDataTab).toHaveAttribute('aria-pressed', 'false')
      await expectReference(picker, 'artifact://', 'x')
      await expect(picker.select).toBeEnabled()

      await picker.cancel.click()
      await expect(picker.sheet).toBeHidden({ timeout: 10_000 })
      await expectRowValue(dialog, 'path', 'artifact://x')
      await closeConfig(dialog)
    })

    await test.step('FP-12: Cancel wrote nothing into the Test', async () => {
      await expect(
        page.getByTestId('toolbar-save-button'),
        'the workbench holds no change to save',
      ).toBeDisabled()
      const values = await persistedValues(request, testId)
      expect(values['fio-read'].path).toBe(OUTSIDE_BOTH)
      expect(values['fio-list'].path).toBe('artifact://x')
    })
  })
})
