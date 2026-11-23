/**
 * V-MCP-RECIPE-NOTE-SIZE-FUNCTIONAL: an amend keeps a Note's size, and a wired Note never crowds the next Block
 * Wireframe: none (deterministic layout on the existing canvas)
 * Design Decisions: none (3.8.2 Block sizing and Stability: a Note's width is always a person's)
 * REQ: REQ-5.2.7.4
 *
 * Seed: each Test is made with `create_test_from_recipe`; the hand-set Note sizes are written through the
 * REST write the canvas Save uses. Every Test is deleted after.
 *
 * Pass Criteria:
 * 1. After an amend, a Note resized to exactly 160 px wide and one resized to 300 x 200 px keep their width
 *    and height, in storage and on the canvas.
 * 2. On create, the Block after a wired four-line Note and after a wired eight-line Note starts at least
 *    32 px below the Note's measured bottom, on whole 140 px rows below the Note: the rows the Note's
 *    estimated height (lines x 22.75 + 51 px, at least 60) plus 32 px needs.
 * 3. The same after an amend that adds a Block at the end.
 * 4. The same after a save and a reload.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { deleteTest } from '../../helpers/element-types'
import { openTest } from '../../helpers/fn-seed'
import { nodeFlowBox, nodeWrapper } from '../../helpers/flow-geometry'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import { SWITCH_TO_EXPRESSION_TITLE, expressionBox, expressionToggle } from '../../helpers/value-field'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import {
  MCP_PORT,
  createFromRecipe,
  freeSlot,
  putWorkflow,
  storedTestDoc,
  tool,
  uniqueName,
  type Doc,
} from './recipe-tool-helpers'

const ROW_PX = 140
const GAP_PX = 32
const LINE_PX = 22.75
// 18 px of padding and border plus the 33 px status bar.
const NOTE_CHROME_PX = 51
const NOTE_MIN_HEIGHT = 60

const lines = (count: number, word: string): string =>
  Array.from({ length: count }, (_, index) => `${word} line ${index + 1}`).join('\n')

const FOUR_LINES = lines(4, 'Four')
const EIGHT_LINES = lines(8, 'Eight')

const logStep = (message: string): Doc => ({ block: 'log', settings: { message, level: 'INFO' } })
const noteStep = (text: string): Doc => ({ note: { text, color: 'yellow' } })

function recipeOf(name: string, flow: Doc[]): string {
  return JSON.stringify({ test: { name, description: 'Wired Notes and their sizes' }, flow }, null, 2)
}

/** The rows a Note takes before the next Block: by its stored height, else by its text's estimate. */
function rowsBelow(count: number, stored?: number): number {
  const height = stored ?? Math.max(NOTE_MIN_HEIGHT, Math.ceil(count * LINE_PX + NOTE_CHROME_PX))
  return Math.ceil((height + GAP_PX) / ROW_PX) * ROW_PX
}

/** Message holds a plain value, so {x} first asks to clear it (FIELD-7): Clear, type the expression, Save. */
async function setMessageExpression(page: Page, blockId: string, expression: string): Promise<void> {
  const sheet = await openBlockSheet(page, blockId)
  await expressionToggle(sheet, 'message').click()
  const ask = page.locator('[data-testid="switch-mode-dialog"]')
  await expect(ask).toHaveAccessibleName(SWITCH_TO_EXPRESSION_TITLE)
  await ask.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(ask).toHaveCount(0)
  const editor = expressionBox(sheet, 'message')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.insertText(expression)
  await expect(editor).toHaveText(expression)
  await leaveExpressionEditor(editor)
  await saveBlockSheet(sheet)
}

interface Canvas {
  nodes: Doc[]
  edges: Doc[]
}

async function canvasOf(request: APIRequestContext, testId: string): Promise<Canvas> {
  const workflow = (await storedTestDoc(request, testId)).workflow as Doc
  return { nodes: workflow.nodes ?? [], edges: workflow.edges ?? [] }
}

function noteWith(canvas: Canvas, text: string): Doc {
  const note = canvas.nodes.find((node) => node.type === 'noteNode' && node.data?.config?.values?.text === text)
  expect(note, `a Note '${text.split('\n')[0]}...' is stored`).toBeTruthy()
  return note as Doc
}

/** The Block the Note's one egress wire leads to. */
function nextOf(canvas: Canvas, note: Doc): Doc {
  const wire = canvas.edges.find((edge) => edge.source === note.id)
  expect(wire, `the Note ${note.id} is wired out`).toBeTruthy()
  return canvas.nodes.find((node) => node.id === wire?.target) as Doc
}

/** Stored: the next Block sits the Note's rows below it. Drawn: it starts at least 32 px below the Note. */
async function expectRoomBelow(
  page: Page,
  request: APIRequestContext,
  testId: string,
  when: string,
  laidOut = true,
): Promise<void> {
  const canvas = await canvasOf(request, testId)
  for (const [text, count] of [[FOUR_LINES, 4], [EIGHT_LINES, 8]] as const) {
    const note = noteWith(canvas, text)
    const next = nextOf(canvas, note)
    // A canvas Save moves nothing, so the row rule is read where the layout ran.
    if (laidOut) {
      expect(next.position.y - note.position.y, `${when}: the Block after the ${count}-line Note is on whole rows below it`).toBe(
        rowsBelow(count, typeof note.height === 'number' ? note.height : undefined),
      )
    }
    const drawnNote = await nodeFlowBox(page, String(note.id))
    const drawnNext = await nodeFlowBox(page, String(next.id))
    expect(
      drawnNext.y - (drawnNote.y + drawnNote.height),
      `${when}: the Block after the ${count}-line Note starts at least ${GAP_PX} px below its drawn bottom`,
    ).toBeGreaterThanOrEqual(GAP_PX)
  }
}

test.describe('V-MCP-RECIPE-NOTE-SIZE-FUNCTIONAL: Note sizes across create and amend', () => {
  const created: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of created.splice(0)) await deleteTest(request, id)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('1. an amend keeps a Note at 160 px wide and one at 300 x 200 px', async ({ page, request }) => {
    test.setTimeout(240_000)
    const name = uniqueName('zz-b29-note-kept')
    const flow = [logStep('before'), noteStep('Kept at 160'), logStep('between'), noteStep('Kept at 300 x 200'), logStep('after')]
    const testId = createFromRecipe(recipeOf(name, flow))
    created.push(testId)

    const workflow = (await storedTestDoc(request, testId)).workflow as Doc
    const canvas = { nodes: workflow.nodes, edges: workflow.edges }
    const narrow = noteWith(canvas, 'Kept at 160')
    const wide = noteWith(canvas, 'Kept at 300 x 200')
    narrow.width = 160
    wide.width = 300
    wide.height = 200
    await putWorkflow(request, testId, workflow)

    await freeSlot(page, request)
    const amended = tool('amend_test_from_recipe', { test_ref: testId, recipe: recipeOf(name, [...flow, logStep('appended')]) })
    expect(amended.amended, JSON.stringify(amended)).toBe(true)

    const after = await canvasOf(request, testId)
    expect(noteWith(after, 'Kept at 160').width, 'a hand-set 160 px width survives the amend').toBe(160)
    const keptWide = noteWith(after, 'Kept at 300 x 200')
    expect([keptWide.width, keptWide.height], 'a hand-set 300 x 200 size survives the amend').toEqual([300, 200])

    await openTest(page, testId)
    const drawnNarrow = await nodeFlowBox(page, String(narrow.id))
    const drawnWide = await nodeFlowBox(page, String(wide.id))
    expect(Math.round(drawnNarrow.width), 'the canvas draws the 160 px Note at 160').toBe(160)
    expect([Math.round(drawnWide.width), Math.round(drawnWide.height)]).toEqual([300, 200])
  })

  test('2 to 4. the Block after a four-line and an eight-line Note is never crowded', async ({ page, request }) => {
    test.setTimeout(300_000)
    const name = uniqueName('zz-b29-note-room')
    const flow = [logStep('first'), noteStep(FOUR_LINES), logStep('after four'), noteStep(EIGHT_LINES), logStep('after eight')]
    const testId = createFromRecipe(recipeOf(name, flow))
    created.push(testId)

    await test.step('2. on create', async () => {
      await openTest(page, testId)
      await expectRoomBelow(page, request, testId, 'on create')
    })

    await test.step('3. after an amend', async () => {
      await freeSlot(page, request)
      const amended = tool('amend_test_from_recipe', { test_ref: testId, recipe: recipeOf(name, [...flow, logStep('appended')]) })
      expect(amended.amended, JSON.stringify(amended)).toBe(true)
      await openTest(page, testId)
      await expectRoomBelow(page, request, testId, 'after the amend')
    })

    await test.step('4. after a save and a reload', async () => {
      const canvas = await canvasOf(request, testId)
      const last = canvas.nodes.find((node) => node.data?.config?.values?.message === 'appended') as Doc
      await setMessageExpression(page, String(last.id), "'appended and saved'")
      await saveTest(page)
      await openTest(page, testId)
      await expect(nodeWrapper(page, String(last.id))).toBeVisible()
      await expectRoomBelow(page, request, testId, 'after save and reload', false)
    })
  })
})
