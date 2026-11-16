/**
 * V-CTRL-FIELDS-UNTOUCHED: a control window opened and closed untouched asks nothing and changes nothing
 * Design Decisions: SAVE-1, CANVAS-230, FIELD-8
 * REQ: REQ-3.5.0.3, REQ-3.5.1.1, REQ-3.5.1.11, REQ-3.5.1.17, REQ-3.5.1.20, REQ-3.5.4.3, REQ-3.1.1.3, REQ-3.4.1.14
 *
 * The seven controls with a field window: Assert, If/Else, Switch, While, Wait Until, Parallel and Variable
 * Setter, each fresh from the palette and each stored (`fixture-untouched.json`).
 *
 * Pass Criteria:
 * 1. Fresh from the palette: opening the window and pressing Escape closes it with no unsaved-changes question,
 *    and the canvas Block's data is the same before and after; a fresh Assert reads as Split, a fresh Wait Until
 *    as Retry and a fresh Parallel as Wait for all.
 * 2. Stored: opening the window and pressing Escape closes it with no unsaved-changes question, the canvas Block's
 *    data is the same before and after, and the Test holds no unsaved change; a later save of the Test stores each
 *    Block exactly as it was stored before the windows were opened.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { waitForCanvasLoad, type PaletteDragSpec } from '../../helpers/canvas'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { dragNodeBy, dropBelowStart, openBlockSheet, saveBtn, saveTest } from '../../helpers/workbench'
import {
  canvasNodeData,
  deleteStoredTest,
  escapeAsksNothing,
  loadFixture,
  nodeOf,
  storedWorkflow,
} from './stored-blocks'

type WindowRead = (sheet: Locator) => Promise<void>

interface ControlCase {
  name: string
  palette: PaletteDragSpec
  /** The stored Block of the same kind in `fixture-untouched.json`. */
  stored: string
  /** What the window shows for a choice the Block does not store. */
  shows?: WindowRead
}

const checked = (id: string): WindowRead => async (sheet) => {
  await expect(sheet.locator(id), `${id} is the choice shown`).toHaveAttribute('data-state', 'checked')
}

const CONTROLS: readonly ControlCase[] = [
  { name: 'Assert', palette: 'assert', stored: '21d544ab-ec6b-4515-8038-009010389113', shows: checked('#mode-split') },
  { name: 'If/Else', palette: 'if', stored: '8707730c-f9e4-4e6b-81cc-1bdb9f8af1de' },
  {
    name: 'Switch',
    palette: { term: 'switch', testId: 'palette-item-switch-case' },
    stored: '7d26dc9c-3523-4f5b-adb9-44971bad138b',
  },
  { name: 'While', palette: 'while', stored: 'f3457f26-bf7c-4205-a158-05f8fd850812' },
  {
    name: 'Wait Until',
    palette: { term: 'wait', testId: 'palette-item-wait-until' },
    stored: '97603cc8-1433-47f3-b74d-94c93b704ff1',
    shows: checked('#wait-mode-retry'),
  },
  {
    name: 'Parallel',
    palette: { term: 'parallel', testId: 'palette-item-parallel' },
    stored: '02c02b7d-16e8-4365-b4ce-47ea2223f53f',
    shows: checked('#join-mode-all'),
  },
  {
    name: 'Variable Setter',
    palette: { term: 'var setter', testId: 'palette-item-variable-setter' },
    stored: '940864cd-f1ca-44de-8959-6c1027b6c28a',
  },
]

const LOG = 'a709a1f1-e30b-4a59-8928-b7c1fad0faf7'

/** A clean workbench canvas holding only Start. */
async function openCleanCanvas(page: Page): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

/** Open the Block's window, read what it shows, press Escape: no question, and the canvas Block is unchanged. */
async function openAndEscape(page: Page, id: string, control: ControlCase, where: string): Promise<void> {
  const before = await canvasNodeData(page, id)
  const sheet = await openBlockSheet(page, id)
  if (control.shows) await control.shows(sheet)
  await escapeAsksNothing(page, sheet, `${where} ${control.name}`)
  expect(await canvasNodeData(page, id), `${where} ${control.name}: the canvas Block is unchanged`).toEqual(before)
}

test.describe('V-CTRL-FIELDS-UNTOUCHED: an untouched control window asks nothing', () => {
  test('fresh from the palette: Escape asks nothing and the canvas Block is unchanged', async ({ page }) => {
    test.setTimeout(240_000)
    try {
      for (const control of CONTROLS) {
        await test.step(`fresh ${control.name}`, async () => {
          await openCleanCanvas(page)
          const id = await dropBelowStart(page, control.palette)
          await openAndEscape(page, id, control, 'fresh')
        })
      }
    } finally {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    }
  })

  test('stored: Escape asks nothing, the Test holds no change, and a later save stores each Block as it was', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await importValidateAndNavigate(page, loadFixture('fixture-untouched.json'), { rejectRepairs: true })
    try {
      const baseline = await test.step('a first save sets the stored baseline', async () => {
        await dragNodeBy(page, LOG, { dx: 60, dy: 0, confirmTestId: 'toolbar-save-button' })
        await saveTest(page)
        return storedWorkflow(request, testId)
      })

      for (const control of CONTROLS) {
        await test.step(`stored ${control.name}`, async () => {
          await openAndEscape(page, control.stored, control, 'stored')
          await expect(saveBtn(page), `stored ${control.name}: the Test holds no unsaved change`).toBeDisabled()
        })
      }

      await test.step('a later save stores each Block as it was stored', async () => {
        await dragNodeBy(page, LOG, { dx: -60, dy: 0, confirmTestId: 'toolbar-save-button' })
        await saveTest(page)
        const after = await storedWorkflow(request, testId)
        for (const control of CONTROLS) {
          expect(nodeOf(after, control.stored).data, `stored ${control.name} is unchanged`).toEqual(
            nodeOf(baseline, control.stored).data,
          )
        }
        expect(after.edges, 'the stored edges are unchanged').toEqual(baseline.edges)
      })
    } finally {
      await deleteStoredTest(request, testId)
    }
  })
})
