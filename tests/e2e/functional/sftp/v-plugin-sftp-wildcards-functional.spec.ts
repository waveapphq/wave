/**
 * V-PLUGIN-SFTP-WILDCARDS-FUNCTIONAL: *, ? and [...] on SFTP Upload, List, Download and Delete
 * Wireframe: N/A
 * Design Decisions: SFTP-3, SFTP-4, SFTP-5, SFTP-8, SFTP-9
 * REQ: REQ-3.4.1.8
 *
 * One workflow chains every permutation inside a Try/Catch whose Finally path removes `{F}`.
 * The fixture's third List carries `{F}/in/*.csv`; the spec types `{F}/in/[ab]*.csv` into its
 * sheet and saves, so WILD-3 passes only with the saved row. The save-as Name preset is read on
 * the wildcard Download's Destination and the sheet is canceled, leaving that block unchanged.
 *
 * Pass Criteria:
 * 1. WILD-1: Upload `testdata://sftp-wild/*.csv` to `{F}/in/` sends a, b and c in path order
 *    (no `notes.txt`) and logs the Upload line with 3 files and their bytes.
 * 2. WILD-2: List `{F}/in/*.csv` gives Count 3 and entries a, b, c (not `.hidden.csv`), typed
 *    columns, path `{F}/in/a.csv`, type `file`.
 * 3. WILD-3: List `{F}/in/[ab]*.csv` typed in the sheet gives Count 2 and
 *    `Listed 2 entries in {F}/in/[ab]*.csv`; List `{F}/in/?.csv` gives Count 3.
 * 4. WILD-4: List `{F}/in/*.nomatch` gives no entries, Count 0, Success true and
 *    `Listed 0 entries in {F}/in/*.nomatch`.
 * 5. WILD-5: Download `{F}/in/*.csv` with no Destination lands a, b, c in the run's artifacts
 *    byte for byte; three Saved artifact lines, then the Download line `... to the run's files`.
 * 6. WILD-6: Download `{F}/in/*.csv` to `artifact://one.csv` (Record and continue) records the
 *    several-matches refusal with 3 and Reason `NotAFolder`; no `one.csv` in the artifacts.
 * 7. WILD-7: Upload `testdata://sftp-wild/*.nomatch` records the Upload no-match refusal and
 *    Download `{F}/in/*.nomatch` records the Download no-match refusal, both Reason `NoMatch`,
 *    each with one WARN failure line.
 * 8. WILD-8: Delete `{F}/in/*.csv` logs `Deleted 3 matches of {F}/in/*.csv` and a List of
 *    `{F}/in` shows only `.hidden.csv`; again with Ignore missing it passes with
 *    `Nothing to delete: {F}/in/*.csv`; again without it records the Nothing to delete refusal,
 *    Reason `NotFound`.
 * 9. WILD-9: the save-as Name preset is empty for a wildcard Source and `a.csv` for
 *    `{F}/in/a.csv`.
 * 10. WILD-10: the Finally path removes `{F}`, a Stats gives Exists false, the run passes.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { escapeRegExp, formatEntries } from '../../helpers/log-reader'
import {
  deleteTest,
  expectReference,
  openConfig,
  openPicker,
  persistedValues,
  saveConfig,
  saveWorkbench,
  type Picker,
} from '../file-picker/picker'
import { listArtifacts } from '../k8s-exec/cases-exec'
import {
  entryRows,
  expectArtifactText,
  expectRecorded,
  fillTextRow,
  importSftpTest,
  loadSftpFixture,
  newSftpRun,
  out,
  runCleanup,
  runSftpTest,
  sftpLine,
  sftpLines,
  summaryRows,
} from './sftp-cases'

const FIXTURE_FILE = 'fixture-wildcards.json'

const NODE = {
  open: '50be4470-4645-4750-acc8-c4f750e11107',
  upload: 'ce26c7a3-68a5-456b-b090-7013f2d438b1',
  touch: '55fba7b6-5f01-486f-9f5f-1f14cb6d41ee',
  listStar: '31e48f7e-f2c4-473d-82bf-dcfdc4fc59b4',
  listClass: '048e894a-2c96-43e4-8705-67afbc97659b',
  listOne: 'f648a9b1-76cc-4aea-8ff4-6079f80f642a',
  listNone: 'f262289a-b2bb-4be6-9912-650fa2e8f7ce',
  download: '888d5309-c72f-4304-b5d2-5d543fe2dfc4',
  downloadOne: 'ab635e55-2b68-4a4a-a048-bea570b89a36',
  uploadNone: 'f3d89380-2590-481f-89fe-656d262b7625',
  downloadNone: 'ecca7c13-1a2c-489f-8778-45089d9723b1',
  delete: 'e4a84314-e7e7-4050-aa16-6ff4b0a67291',
  listIn: 'baa34c6a-32c1-4481-ad1f-73eaeca88c5a',
  deleteIgnore: '2c83e4bd-2665-4edd-bb0d-1acfd5d73228',
  deleteStrict: '5b5084b7-d99f-461c-bc01-c228d5b3a30f',
  removeFolder: '7cfd53f8-d701-4146-b8fa-185ae85bce68',
  statsGone: '8e728fe2-4019-4a13-a722-33949c54db61',
  close: 'fa10c63c-bea9-4010-a800-d64f254ab0ed',
  done: '14124d91-cbeb-436d-9ee6-a6799057fa0b',
} as const

const RECORDED: readonly string[] = [NODE.downloadOne, NODE.uploadNone, NODE.downloadNone, NODE.deleteStrict]

const run = newSftpRun('sftp-wildcards')
const F = run.folder
const IN = `${F}/in`
const CLASS_PATTERN = `${IN}/[ab]*.csv`
const BOOKEND = `sftp-wildcards-done-${run.uuid}`
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/

const CSV = {
  'a.csv': `name,marker\nalpha,${run.uuid}\n`,
  'b.csv': `name,marker\nbravo,${run.uuid}\n`,
  'c.csv': `name,marker\ncharlie,${run.uuid}\n`,
} as const
const CSV_NAMES = Object.keys(CSV) as Array<keyof typeof CSV>
const bytesOf = (name: keyof typeof CSV): number => Buffer.byteLength(CSV[name])
const CSV_BYTES = CSV_NAMES.reduce((total, name) => total + bytesOf(name), 0)
const NOTES = `not a csv ${run.uuid}\n`
const absoluteTo = (tail: string): RegExp => new RegExp(`^/.*/${escapeRegExp(tail)}$`)

const createdTests: string[] = []

async function cancelPicker(picker: Picker): Promise<void> {
  await picker.cancel.click()
  await expect(picker.sheet).toBeHidden({ timeout: 10_000 })
}

/** Close a config sheet whose edits must not be kept. */
async function discardConfig(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: /^Cancel$/ }).last().click()
  const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(unsaved).toBeVisible()
  await unsaved.getByTestId('unsaved-close').click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

test.describe('V-PLUGIN-SFTP-WILDCARDS-FUNCTIONAL: wildcards on Upload, List, Download and Delete', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterAll(async ({ request }) => {
    await runCleanup(request, { account: 'wave', paths: [F] })
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('WILD-1..WILD-10: *, ? and [...] matches, no-match outcomes, several matches onto one name, the Name preset', async ({
    page,
    request,
  }) => {
    const testId = await test.step('import the fixture with sftp-wild in its Test Data', async () => {
      const fixture = loadSftpFixture(__dirname, FIXTURE_FILE, run)
      const id = await importSftpTest(page, fixture, {
        files: [
          ...CSV_NAMES.map((name) => ({ folder: 'sftp-wild', name, body: Buffer.from(CSV[name]) })),
          { folder: 'sftp-wild', name: 'notes.txt', body: Buffer.from(NOTES) },
        ],
      })
      createdTests.push(id)
      return id
    })

    const downloadBefore = (await persistedValues(request, testId))[NODE.download]

    await test.step('WILD-9: the save-as Name preset follows the Source, and the sheet is canceled', async () => {
      expect(downloadBefore.source, 'the fixture Download reads a wildcard').toBe(`${IN}/*.csv`)
      const sheet = await openConfig(page, NODE.download)

      const wildcard = await openPicker(page, sheet, 'destination', 'save-as')
      await expect(wildcard.name, 'a wildcard Source presets no Name').toHaveValue('')
      await expectReference(wildcard, 'artifact://', '')
      await cancelPicker(wildcard)

      await fillTextRow(page, sheet, 'source', `${IN}/a.csv`)
      const single = await openPicker(page, sheet, 'destination', 'save-as')
      await expect(single.name, 'a single-file Source presets its own name').toHaveValue('a.csv')
      await expectReference(single, 'artifact://', 'a.csv')
      await cancelPicker(single)

      await discardConfig(page, sheet)
    })

    await test.step('WILD-3: [ab]*.csv is typed into the List sheet and saved', async () => {
      expect((await persistedValues(request, testId))[NODE.listClass].path, 'the fixture lists *.csv').toBe(
        `${IN}/*.csv`,
      )
      const sheet = await openConfig(page, NODE.listClass)
      await fillTextRow(page, sheet, 'path', CLASS_PATTERN)
      await saveConfig(sheet)
      await saveWorkbench(page)

      const saved = await persistedValues(request, testId)
      expect(saved[NODE.listClass].path, 'the saved Path').toBe(CLASS_PATTERN)
      expect(saved[NODE.download], 'the canceled Download sheet changed nothing').toEqual(downloadBefore)
    })

    const { vars, entries } = await runSftpTest(page, testId, BOOKEND)
    const consoleText = formatEntries(entries)

    await test.step('WILD-1: Upload sends the csv matches in path order and leaves notes.txt', () => {
      const rows = summaryRows(vars, 'up_summary')
      expect(rows.map((row) => row.destination), 'Summary in path order').toEqual(
        CSV_NAMES.map((name) => `${IN}/${name}`),
      )
      rows.forEach((row, index) => {
        const name = CSV_NAMES[index]
        expect(row.source, `an absolute WAVE path to ${name}`).toMatch(absoluteTo(`sftp-wild/${name}`))
        expect(row.size, `${name} size`).toBe(bytesOf(name))
      })
      expect(out(vars, 'up_success')).toBe(true)
      expect(sftpLines(entries, 'Upload the csv matches'), consoleText).toEqual([
        sftpLine.uploaded(3, CSV_BYTES, 'testdata://sftp-wild/*.csv', `${IN}/`),
      ])
      expect(out(vars, 'touch_exit'), `touch stderr: ${String(out(vars, 'touch_stderr'))}`).toBe(0)
    })

    await test.step('WILD-2: List *.csv gives a, b and c, never the hidden file', () => {
      const rows = entryRows(vars, 'star_entries')
      expect(rows.map(({ name, path, type, size }) => [name, path, type, size])).toEqual(
        CSV_NAMES.map((name) => [name, `${IN}/${name}`, 'file', bytesOf(name)]),
      )
      for (const row of rows) expect(row.modified, `${row.name} modified`).toMatch(ISO_UTC)
      expect(out(vars, 'star_count'), 'Count').toBe(3)
      expect(out(vars, 'star_success')).toBe(true)
      expect(sftpLines(entries, 'List the csv matches'), consoleText).toEqual([
        sftpLine.listed(3, `${IN}/*.csv`),
      ])
    })

    await test.step('WILD-3: [ab]*.csv lists two, ?.csv lists three', () => {
      expect(entryRows(vars, 'class_entries').map((row) => row.name)).toEqual(['a.csv', 'b.csv'])
      expect(out(vars, 'class_count'), 'Count').toBe(2)
      expect(sftpLines(entries, 'List the a and b matches'), consoleText).toEqual([
        sftpLine.listed(2, CLASS_PATTERN),
      ])
      expect(entryRows(vars, 'one_letter_entries').map((row) => row.name)).toEqual(CSV_NAMES)
      expect(out(vars, 'one_letter_count'), 'Count').toBe(3)
      expect(sftpLines(entries, 'List the one-letter matches'), consoleText).toEqual([
        sftpLine.listed(3, `${IN}/?.csv`),
      ])
    })

    await test.step('WILD-4: a List pattern with no match gives no entries and passes', () => {
      expect(entryRows(vars, 'none_entries')).toEqual([])
      expect(out(vars, 'none_count'), 'Count').toBe(0)
      expect(out(vars, 'none_success'), 'Success').toBe(true)
      expect(sftpLines(entries, 'List a pattern with no match'), consoleText).toEqual([
        sftpLine.listed(0, `${IN}/*.nomatch`),
      ])
      expect(sftpLines(entries, 'List a pattern with no match', 'WARN'), consoleText).toEqual([])
    })

    await test.step('WILD-5: Download with no Destination lands every match in the run artifacts', async () => {
      const rows = summaryRows(vars, 'down_summary')
      expect(rows.map((row) => row.source), 'Summary in path order').toEqual(
        CSV_NAMES.map((name) => `${IN}/${name}`),
      )
      rows.forEach((row, index) => {
        const name = CSV_NAMES[index]
        expect(row.destination, `an absolute WAVE path to ${name}`).toMatch(absoluteTo(name))
        expect(row.size, `${name} size`).toBe(bytesOf(name))
      })
      expect(out(vars, 'down_success')).toBe(true)
      expect(sftpLines(entries, 'Download the csv matches'), consoleText).toEqual([
        ...rows.map((row, index) => sftpLine.saved(CSV_NAMES[index], row.destination, row.size)),
        sftpLine.downloaded(3, CSV_BYTES, `${IN}/*.csv`, "the run's files"),
      ])
      for (const name of CSV_NAMES) await expectArtifactText(page, name, CSV[name])
    })

    await test.step('WILD-6: several matches onto one name are refused and recorded', async () => {
      expectRecorded(vars, entries, {
        key: 'onto_one',
        name: 'Download onto one name',
        operation: 'Download',
        reason: 'NotAFolder',
        message: `3 paths match ${IN}/*.csv, so Destination must be an existing folder or end with /: artifact://one.csv`,
      })
      expect(summaryRows(vars, 'onto_one_summary'), 'nothing was written').toEqual([])
      const paths = (await listArtifacts(page)).map((item) => item.path)
      expect(paths, 'no one.csv in the artifacts').not.toContain('one.csv')
      for (const name of CSV_NAMES) expect(paths, `${name} from WILD-5`).toContain(name)
    })

    await test.step('WILD-7: Upload and Download of a pattern with no match are recorded', () => {
      expectRecorded(vars, entries, {
        key: 'up_none',
        name: 'Upload a pattern with no match',
        operation: 'Upload',
        reason: 'NoMatch',
        message: 'Nothing on WAVE matches testdata://sftp-wild/*.nomatch',
      })
      expectRecorded(vars, entries, {
        key: 'down_none',
        name: 'Download a pattern with no match',
        operation: 'Download',
        reason: 'NoMatch',
        message: `Nothing on the SFTP server matches ${IN}/*.nomatch`,
      })
    })

    await test.step('WILD-8: Delete *.csv leaves only the hidden file, then Ignore missing decides', () => {
      expect(sftpLines(entries, 'Delete the csv matches'), consoleText).toEqual([
        sftpLine.deletedMatches(3, `${IN}/*.csv`),
      ])
      expect(out(vars, 'del_success')).toBe(true)
      const left = entryRows(vars, 'in_entries').map(({ name, path, type, size }) => [name, path, type, size])
      expect(left, 'only the hidden file stays').toEqual([['.hidden.csv', `${IN}/.hidden.csv`, 'file', 0]])
      expect(out(vars, 'in_count'), 'Count').toBe(1)

      expect(sftpLines(entries, 'Delete again with Ignore missing'), consoleText).toEqual([
        sftpLine.nothingToDelete(`${IN}/*.csv`),
      ])
      expect(out(vars, 'del_ignore_success'), 'Ignore missing passes').toBe(true)

      expectRecorded(vars, entries, {
        key: 'del_strict',
        name: 'Delete without Ignore missing',
        operation: 'Delete',
        reason: 'NotFound',
        message: `Nothing to delete: ${IN}/*.csv`,
      })
    })

    await test.step('WILD-10: the Finally path removes the folder and Stats proves it gone', async () => {
      expect(sftpLines(entries, 'Remove the spec folder'), consoleText).toEqual([sftpLine.deleted(F)])
      expect(out(vars, 'remove_success')).toBe(true)
      expect(sftpLines(entries, 'Stats of the removed folder'), consoleText).toEqual([sftpLine.stats(F)])
      expect(out(vars, 'gone_exists'), 'Exists').toBe(false)
      expect(out(vars, 'gone_type'), 'Type').toBe('')
      expect(out(vars, 'wild_caught'), 'the Try path raised nothing').toBe(false)

      for (const id of RECORDED) await expectNodeStatus(page, id, 'warning')
      for (const id of Object.values(NODE).filter((id) => !RECORDED.includes(id))) {
        await expectNodeStatus(page, id, 'success')
      }
    })
  })
})
