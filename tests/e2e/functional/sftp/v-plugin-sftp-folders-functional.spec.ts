/**
 * V-PLUGIN-SFTP-FOLDERS-FUNCTIONAL: SFTP on folder trees
 * Wireframe: N/A
 * Design Decisions: SFTP-3, SFTP-4, SFTP-5, SFTP-7, SFTP-8, SFTP-9
 * REQ: REQ-3.4.1.8
 *
 * One workflow chains every leg inside a Try/Catch whose Finally removes {F}. The fixture's first
 * Upload carries `testdata://sftp-tree-placeholder`, which does not exist; the spec picks the
 * `sftp-tree` folder with Browse and saves, so the run passes only with the picked value. SSH
 * Session Exec makes `extra.txt` (and grows `a.txt`) before the merge and the link
 * `link.txt -> a.txt` before the download.
 *
 * Pass Criteria:
 * 1. FOLD-1: Upload `testdata://sftp-tree` to `{F}/tree` gives 3 Summary rows (files only) and
 *    the Upload line; a List with Include subfolders shows a.txt, empty, sub, sub/b.txt,
 *    sub/deeper, sub/deeper/c.txt sorted by path, folders sized 0.
 * 2. FOLD-2: Upload `testdata://sftp-tree/*` to `{F}/tree/` with Replace it lands each match by
 *    its own name: a.txt back to the Test Data size, sub and empty merged, extra.txt kept, no
 *    `{F}/tree/sftp-tree`.
 * 3. FOLD-3: the same Upload with Fail the block (Record and continue) gives the Destination
 *    exists refusal naming `{F}/tree/a.txt`, Reason `Exists`, an empty Summary, and the tree is
 *    unchanged.
 * 4. FOLD-4: Download `{F}/tree` to `artifact://tree-copy/` logs the Skipped symbolic link line
 *    for link.txt, four Saved artifact lines then the Download line; the artifacts hold the four
 *    files with the server's bytes and no link.txt.
 * 5. FOLD-5: Stats of a file, a folder and a missing path.
 * 6. FOLD-6: Move `{F}/tree/a.txt` to `{F}/tree/moved/` logs the Move line and a Stats confirms
 *    it.
 * 7. FOLD-7: Create folder logs `Created folder`, then `Folder already exists`; over a file it
 *    gives the Not a folder refusal, Reason `NotAFolder`.
 * 8. FOLD-8: Delete `{F}/tree` logs the Delete line and a Stats gives Exists false.
 * 9. FOLD-9: the Finally path removes {F}; the run passes.
 * 10. FOLD-10: Move `{F}/tree/sub` to `{F}/tree/` (Record and continue) is refused with Reason
 *     `Conflict`; a List of `{F}/tree/sub` still shows b.txt and deeper.
 * 11. FOLD-11: a Move with Source `.` is caught by a Try/Catch with the home-refusal text and the
 *     server is unchanged (the spec folder lists the same before and after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForViewportSettled } from '../../helpers/canvas'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { escapeRegExp, expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import {
  confirmPicker,
  deleteTest,
  expectReference,
  expectRowValue,
  openConfig,
  openPicker,
  persistedValues,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'
import { listArtifacts } from '../k8s-exec/cases-exec'
import {
  entryRows,
  expectArtifactText,
  expectRecorded,
  importSftpTest,
  loadSftpFixture,
  newSftpRun,
  out,
  runCleanup,
  runSftpTest,
  sftpLine,
  sftpLines,
  summaryRows,
  type EntryRow,
} from './sftp-cases'

const FIXTURE_FILE = 'fixture-folders.json'

const NODE = {
  open: 'f914b919-d25b-4aa2-a082-f9b543b9729e',
  upTree: 'b1d45a5e-4d82-4661-abc1-4a65e9a8cc4b',
  listTree: 'e238bb1a-d9c5-404f-aea6-f33f54bf67b3',
  makeExtra: 'e7153af2-c9bb-4046-9466-b24d356d26b1',
  statGrown: 'acc5cb1b-06e9-48d1-b3a5-3218c727ae30',
  upMerge: '49c0b5b5-cda1-435e-96ff-d40d93eb0abc',
  listMerged: '45106a36-3b0d-4d78-bc37-3762df1d2a1f',
  upFail: '5c5cdac0-77f2-4236-9bba-cae10c3e95fb',
  listAfterFail: '8b6720fc-da66-4045-82ed-70e5229186b3',
  makeLink: 'f2f0d51c-7d74-4864-a8d5-c68324206ce8',
  download: 'aa0b3934-4d9f-491b-a756-607ecb23e9c2',
  statA: '46895340-491e-4470-beaa-7872a5c070fb',
  statSub: '17607f92-7de6-4f0d-9beb-a7202f79fd94',
  statNope: '2569ecc7-fe16-4be6-a6a1-04f2d0f06760',
  moveA: '6eeb7ce4-4fca-4159-826c-07051f1629ae',
  statMoved: 'f72c5f19-e7c6-428a-b9d1-2124ff360f99',
  statOld: 'bcefd470-6459-47f8-ac84-29b03d5a4b1f',
  mkdir: 'd9ae4f9e-b3e8-4cfe-86db-4d22fff97ab8',
  mkdirAgain: 'f60af86a-1456-474a-9935-0f3a06c191df',
  mkdirFile: '30d87c49-2532-4a1c-baae-58b6b279e949',
  moveSub: '4f34b1fc-8c2f-4646-b871-564fb0500f71',
  listSub: 'abbc5809-0f03-4a93-843c-9af279706c59',
  listBefore: 'fcc8a8ba-4c11-4a59-a53c-1154fabd18f7',
  moveHome: 'fca8a6ea-85c4-4890-8061-1d99403e1f67',
  homeCaught: 'ff06bb47-b5cc-4b8d-8ede-ef66077105be',
  listAfter: '2b3a7ab5-2003-46da-b4c8-1b2ba760131f',
  statHomeMove: 'f3a917e1-a9fc-4154-ac89-2ee1dae87af6',
  deleteTree: 'e7361f73-89a0-411a-a878-45477877ce2a',
  statTree: 'e9c07c6f-a0a9-4621-b327-52433e9a7959',
  deleteF: '90c28517-5b69-401b-90f1-10e74befd390',
  statF: 'f2bb56de-526a-4375-9e69-1f44568536a1',
  close: '9df77edf-c076-46f5-ba4b-9ecd669c98b2',
  done: '87423eee-22de-4b7c-902d-f1f96a01a880',
} as const

const RECORDED = [NODE.upFail, NODE.mkdirFile, NODE.moveSub] as const

const run = newSftpRun('sftp-folders')
const F = run.folder
const TREE = `${F}/tree`
const BOOKEND = `sftp-folders-done-${run.uuid}`
const PLACEHOLDER = 'testdata://sftp-tree-placeholder'
const PICKED = 'testdata://sftp-tree'
const MATCHES = 'testdata://sftp-tree/*'

const A = `alpha ${run.uuid}\n`
const B = `bravo bravo ${run.uuid}\n`
const C = `charlie charlie charlie ${run.uuid}\n`
// Written by the fixture's SSH Session Exec (`echo`), so each ends with a newline.
const EXTRA = `extra-${run.uuid}\n`
const STALE_TAIL = 'stale-tail\n'
const size = (text: string): number => Buffer.byteLength(text)
const TREE_BYTES = size(A) + size(B) + size(C)
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/

const createdTests: string[] = []

const shape = (rows: EntryRow[]): Array<[string, string, string, number]> =>
  rows.map(({ name, path, type, size: bytes }) => [name, path, type, bytes])

type Box = { x: number; y: number; width: number; height: number }

async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox()
  expect(box, `${what} has a box`).not.toBeNull()
  return box as Box
}

/** A point on the empty canvas pane at height `y`, so a drag there pans instead of moving a Block. */
async function panePoint(page: Page, area: Box, y: number): Promise<{ x: number; y: number }> {
  for (const fraction of [0.92, 0.08, 0.75, 0.25]) {
    const x = area.x + area.width * fraction
    const onPane = await page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.classList.contains('react-flow__pane') ?? false,
      [x, y] as const,
    )
    if (onPane) return { x, y }
  }
  throw new Error(`no empty pane at height ${y}`)
}

// The chain is taller than the canvas at its minimum zoom, so the Block is panned into view as a user would.
async function revealNode(page: Page, nodeId: string): Promise<void> {
  const canvas = page.getByTestId('workflow-canvas')
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  for (let attempt = 0; attempt < 8; attempt++) {
    const area = await boxOf(canvas, 'the canvas')
    const box = await boxOf(node, `Block ${nodeId}`)
    if (box.y >= area.y + 20 && box.y + box.height <= area.y + area.height - 20) return
    const reach = area.height - 120
    const shift = Math.max(-reach, Math.min(reach, area.y + area.height / 2 - (box.y + box.height / 2)))
    const start = await panePoint(page, area, shift > 0 ? area.y + 60 : area.y + area.height - 60)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y + shift, { steps: 10 })
    await page.mouse.up()
    await waitForViewportSettled(page)
  }
  throw new Error(`Block ${nodeId} is still outside the canvas after panning`)
}

test.describe('V-PLUGIN-SFTP-FOLDERS-FUNCTIONAL: SFTP on folder trees', () => {
  test.afterAll(async ({ request }) => {
    await runCleanup(request, { account: 'wave', paths: [F] })
    for (const testId of createdTests.splice(0)) await deleteTest(request, testId)
  })

  test('FOLD-1..FOLD-11: upload, merge, refuse, download, stats, move, create and delete a tree', async ({
    page,
    request,
  }) => {
    const testId = await test.step('import the fixture with the sftp-tree Test Data folder', async () => {
      const fixture = loadSftpFixture(__dirname, FIXTURE_FILE, run)
      const id = await importSftpTest(page, fixture, {
        files: [
          { folder: 'sftp-tree', name: 'a.txt', body: Buffer.from(A) },
          { folder: 'sftp-tree/sub', name: 'b.txt', body: Buffer.from(B) },
          { folder: 'sftp-tree/sub/deeper', name: 'c.txt', body: Buffer.from(C) },
        ],
        folders: ['sftp-tree/empty'],
      })
      createdTests.push(id)
      return id
    })

    await test.step('the first Upload Source is picked with Browse and saved', async () => {
      const before = await persistedValues(request, testId)
      expect(before[NODE.upTree].source, 'the fixture carries a Source that does not exist').toBe(PLACEHOLDER)

      await revealNode(page, NODE.upTree)
      const sheet = await openConfig(page, NODE.upTree)
      const picker = await openPicker(page, sheet, 'source', 'file-or-folder')
      await picker.testDataTab.click()
      await expect(picker.testDataTab).toHaveAttribute('aria-pressed', 'true')
      await picker.folder('sftp-tree').click()
      await expectReference(picker, 'testdata://', 'sftp-tree')
      await confirmPicker(picker)
      await expectRowValue(sheet, 'source', PICKED)
      await saveConfig(sheet)
      await saveWorkbench(page)

      const after = await persistedValues(request, testId)
      expect(after[NODE.upTree].source, 'the saved Source is the picked folder').toBe(PICKED)
    })

    const { vars, entries } = await runSftpTest(page, testId, BOOKEND)
    const consoleText = formatEntries(entries)
    const lines = (name: string): string[] => sftpLines(entries, name)

    await test.step('FOLD-1: the folder upload sends files only and the List shows the whole tree', () => {
      const rows = summaryRows(vars, 'up1_summary')
      expect(rows.map((row) => [row.destination, row.size])).toEqual([
        [`${TREE}/a.txt`, size(A)],
        [`${TREE}/sub/b.txt`, size(B)],
        [`${TREE}/sub/deeper/c.txt`, size(C)],
      ])
      const relatives = ['a.txt', 'sub/b.txt', 'sub/deeper/c.txt']
      rows.forEach((row, i) => {
        expect(row.source, 'an absolute WAVE path into sftp-tree').toMatch(
          new RegExp(`^/.*/sftp-tree/${escapeRegExp(relatives[i])}$`),
        )
      })
      expect(lines('Upload the tree'), consoleText).toEqual([sftpLine.uploaded(3, TREE_BYTES, PICKED, TREE)])

      const listed = entryRows(vars, 'list1_entries')
      expect(shape(listed)).toEqual([
        ['a.txt', `${TREE}/a.txt`, 'file', size(A)],
        ['empty', `${TREE}/empty`, 'folder', 0],
        ['sub', `${TREE}/sub`, 'folder', 0],
        ['b.txt', `${TREE}/sub/b.txt`, 'file', size(B)],
        ['deeper', `${TREE}/sub/deeper`, 'folder', 0],
        ['c.txt', `${TREE}/sub/deeper/c.txt`, 'file', size(C)],
      ])
      for (const entry of listed) expect(entry.modified, entry.path).toMatch(ISO_UTC)
      expect(out(vars, 'list1_count'), 'Count').toBe(6)
      expect(lines('List the uploaded tree'), consoleText).toEqual([sftpLine.listed(6, TREE)])
    })

    await test.step('FOLD-2: the /* upload merges into the existing tree', () => {
      expect(out(vars, 'x1_exit'), `extra.txt made: ${String(out(vars, 'x1_stderr'))}`).toBe(0)
      expect(out(vars, 'grown_size'), 'a.txt grew on the server before the merge').toBe(
        size(A) + size(STALE_TAIL),
      )
      const rows = summaryRows(vars, 'up2_summary')
      expect(rows.map((row) => [row.destination, row.size])).toEqual([
        [`${TREE}/a.txt`, size(A)],
        [`${TREE}/sub/b.txt`, size(B)],
        [`${TREE}/sub/deeper/c.txt`, size(C)],
      ])
      expect(lines('Upload with Replace it'), consoleText).toEqual([
        sftpLine.uploaded(3, TREE_BYTES, MATCHES, `${TREE}/`),
      ])

      const merged = entryRows(vars, 'list2_entries')
      expect(shape(merged), 'a.txt replaced, sub and empty merged, extra.txt kept').toEqual([
        ['a.txt', `${TREE}/a.txt`, 'file', size(A)],
        ['empty', `${TREE}/empty`, 'folder', 0],
        ['extra.txt', `${TREE}/extra.txt`, 'file', size(EXTRA)],
        ['sub', `${TREE}/sub`, 'folder', 0],
        ['b.txt', `${TREE}/sub/b.txt`, 'file', size(B)],
        ['deeper', `${TREE}/sub/deeper`, 'folder', 0],
        ['c.txt', `${TREE}/sub/deeper/c.txt`, 'file', size(C)],
      ])
      expect(merged.map((entry) => entry.path)).not.toContain(`${TREE}/sftp-tree`)
      expect(out(vars, 'list2_count'), 'Count').toBe(7)
    })

    await test.step('FOLD-3: Fail the block refuses on the first file target and writes nothing', async () => {
      expectRecorded(vars, entries, {
        key: 'up3',
        name: 'Upload with Fail the block',
        operation: 'Upload',
        reason: 'Exists',
        message: `Destination exists and If the file exists is Fail the block: ${TREE}/a.txt`,
      })
      expect(summaryRows(vars, 'up3_summary'), 'no file was sent').toEqual([])
      expect(lines('Upload with Fail the block'), 'no Upload line').toEqual([])
      expect(entryRows(vars, 'list3_entries'), 'the server tree is unchanged, times included').toEqual(
        entryRows(vars, 'list2_entries'),
      )
      await expectNodeStatus(page, NODE.upFail, 'warning')
    })

    await test.step('FOLD-4: the folder download skips the link and lands four files', async () => {
      expect(out(vars, 'x2_exit'), `link made: ${String(out(vars, 'x2_stderr'))}`).toBe(0)
      const expected = [
        { server: `${TREE}/a.txt`, relative: 'tree-copy/tree/a.txt', text: A },
        { server: `${TREE}/extra.txt`, relative: 'tree-copy/tree/extra.txt', text: EXTRA },
        { server: `${TREE}/sub/b.txt`, relative: 'tree-copy/tree/sub/b.txt', text: B },
        { server: `${TREE}/sub/deeper/c.txt`, relative: 'tree-copy/tree/sub/deeper/c.txt', text: C },
      ]
      const rows = summaryRows(vars, 'down_summary')
      expect(rows.map((row) => [row.source, row.size])).toEqual(expected.map((file) => [file.server, size(file.text)]))
      rows.forEach((row, i) => {
        expect(row.destination, 'an absolute WAVE path in the run artifacts').toMatch(
          new RegExp(`^/.*/${escapeRegExp(expected[i].relative)}$`),
        )
      })
      const total = expected.reduce((sum, file) => sum + size(file.text), 0)
      expect(lines('Download the tree'), consoleText).toEqual([
        sftpLine.skippedLink(`${TREE}/link.txt`),
        ...rows.map((row, i) => sftpLine.saved(expected[i].relative, row.destination, row.size)),
        sftpLine.downloaded(4, total, TREE, 'artifact://tree-copy/'),
      ])
      for (const file of expected) await expectArtifactText(page, file.relative, file.text)

      const landed = (await listArtifacts(page))
        .map((artifact) => artifact.path)
        .filter((path) => path.startsWith('tree-copy/'))
        .sort()
      expect(landed, 'the four files and no link.txt').toEqual(expected.map((file) => file.relative))
    })

    await test.step('FOLD-5: Stats of a file, a folder and a missing path', () => {
      expect(out(vars, 'st_a_exists')).toBe(true)
      expect(out(vars, 'st_a_type')).toBe('file')
      expect(out(vars, 'st_a_size')).toBe(size(A))
      expect(out(vars, 'st_a_modified')).toMatch(ISO_UTC)
      expect(lines('Stats of a.txt'), consoleText).toEqual([sftpLine.stats(`${TREE}/a.txt`)])

      expect(out(vars, 'st_sub_exists')).toBe(true)
      expect(out(vars, 'st_sub_type')).toBe('folder')
      expect(out(vars, 'st_sub_size')).toBe(0)
      expect(lines('Stats of sub'), consoleText).toEqual([sftpLine.stats(`${TREE}/sub`)])

      expect(out(vars, 'st_nope_exists')).toBe(false)
      expect(out(vars, 'st_nope_type')).toBe('')
      expect(out(vars, 'st_nope_size')).toBe(0)
      expect(out(vars, 'st_nope_modified')).toBe('')
      expect(out(vars, 'st_nope_success')).toBe(true)
      expect(lines('Stats of a missing path'), consoleText).toEqual([sftpLine.stats(`${TREE}/nope`)])
    })

    await test.step('FOLD-6: Move into a missing folder creates it and keeps the name', () => {
      expect(lines('Move a.txt into a missing folder'), consoleText).toEqual([
        sftpLine.moved(`${TREE}/a.txt`, `${TREE}/moved/a.txt`),
      ])
      expect(out(vars, 'st_moved_exists')).toBe(true)
      expect(out(vars, 'st_moved_type')).toBe('file')
      expect(out(vars, 'st_moved_size')).toBe(size(A))
      expect(out(vars, 'st_old_exists'), 'moved, not copied').toBe(false)
    })

    await test.step('FOLD-7: Create folder, again, and over a file', async () => {
      expect(lines('Create a nested folder'), consoleText).toEqual([sftpLine.createdFolder(`${TREE}/new/deep`)])
      expect(lines('Create the nested folder again'), consoleText).toEqual([
        sftpLine.folderExists(`${TREE}/new/deep`),
      ])
      expectRecorded(vars, entries, {
        key: 'mkfile',
        name: 'Create a folder over extra.txt',
        operation: 'Create folder',
        reason: 'NotAFolder',
        message: `Not a folder on the SFTP server: ${TREE}/extra.txt`,
      })
      await expectNodeStatus(page, NODE.mkdirFile, 'warning')
    })

    await test.step('FOLD-10: a Move onto the folder holding its source is refused and changes nothing', async () => {
      expectRecorded(vars, entries, {
        key: 'movesub',
        name: 'Move sub onto its own folder',
        operation: 'Move',
        reason: 'Conflict',
        message: `Cannot move ${TREE}/sub to ${TREE}/sub: the target is the source itself or a folder holding it`,
      })
      await expectNodeStatus(page, NODE.moveSub, 'warning')
      const sub = entryRows(vars, 'list_sub_entries').map(({ name, path, type }) => [name, path, type])
      expect(sub, 'sub still holds its contents').toEqual([
        ['b.txt', `${TREE}/sub/b.txt`, 'file'],
        ['deeper', `${TREE}/sub/deeper`, 'folder'],
      ])
      expect(out(vars, 'list_sub_count')).toBe(2)
    })

    await test.step('FOLD-11: a Move of the home is caught and the server is unchanged', async () => {
      expect(out(vars, 'home_caught'), 'the Try/Catch caught the Move').toBe(true)
      const error = out(vars, 'home_error') as Record<string, unknown>
      expect(error.message).toBe(
        ". names the account's home, a folder above it or the SFTP server's root folder and cannot be moved",
      )
      expect(error.node_id, 'the error points at the Move block').toBe(NODE.moveHome)
      await expectNodeStatus(page, NODE.moveHome, 'failed')
      await expectNodeStatus(page, NODE.homeCaught, 'success')
      expectConsoleLine(entries, 'WARN', 'sftp-folders home move caught')
      expect(lines('Move the home folder'), 'no Move line').toEqual([])

      const before = entryRows(vars, 'before_home_entries')
      expect(before.map((entry) => entry.path), 'the spec folder holds the tree').toContain(`${TREE}/sub/b.txt`)
      expect(entryRows(vars, 'after_home_entries'), 'the spec folder lists the same, times included').toEqual(before)
      expect(out(vars, 'st_homemove_exists'), 'nothing arrived at the Move destination').toBe(false)
    })

    await test.step('FOLD-8: Delete removes the tree', () => {
      expect(lines('Delete the tree'), consoleText).toEqual([sftpLine.deleted(TREE)])
      expect(out(vars, 'st_tree_exists')).toBe(false)
    })

    await test.step('FOLD-9: the Finally path removes the spec folder and every leg ends as planned', async () => {
      expect(lines('Delete the spec folder'), consoleText).toEqual([sftpLine.deleted(F)])
      expect(out(vars, 'st_f_exists')).toBe(false)
      expect(out(vars, 'outer_caught'), 'no leg failed the Try path').toBe(false)
      const planned = new Set<string>([...RECORDED, NODE.moveHome])
      for (const id of Object.values(NODE).filter((id) => !planned.has(id))) {
        await expectNodeStatus(page, id, 'success')
      }
    })
  })
})
