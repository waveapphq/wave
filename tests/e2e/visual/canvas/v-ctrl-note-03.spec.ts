/**
 * V-CTRL-NOTE-03: a Note draws its inputs as a Block does
 * Wireframe: none
 * Design Decisions: none
 * REQ: REQ-3.1.1.2
 *
 * Seeds (API): one Test per test through `POST /tests`, deleted after it.
 * S1: Start, an If/Else whose if branch is Log `if path` and whose else branch is Log `else path`; both Logs join into
 *     one Note (the second wire on the Note's `ingress_1` input), then Log `after`.
 * S2 and S3: Start, Log `first`, a Note and Log `after` wired in a line, and Log `second` beside them with nothing wired.
 *
 * Pass Criteria:
 * S1 (light and dark): the Note shows two input dots, `note-handle-input` and `note-handle-input-ingress_1`, each of the
 *    size and color of a Block's input dot, and each wire coming in ends on its own dot.
 * S2: while a wire from `second` is dragged near the Note, the green `+` input `note-handle-input-add` shows; dropping
 *    on it connects, the Note then shows two inputs, the new wire ends on the second one, and Save stores
 *    `first -> Note` on the default input and `second -> Note` with `targetHandle: ingress_1`.
 * S3: while a wire from `after` (below the Note) is dragged back to the Note, the Note shows the cycle mark
 *    `note-handle-input-cycle`; the drop makes no wire and the Note keeps its one input.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { waitForViewportSettled } from '../../helpers/canvas'
import { handleCenter } from '../../helpers/edge-drag'
import { inBothThemes } from '../../helpers/entry-editors'
import { cleanUp } from '../../helpers/fn-block'
import { openTest } from '../../helpers/fn-seed'
import { controlNode, edge, handleEdge, markerNode, type WorkflowEdge } from '../../helpers/k8s-nodes'
import { saveTest } from '../../helpers/workbench'
import { noteNode, type CanvasNode } from '../../functional/note-control/note-flows'

type Box = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type StoredEdge = { id: string; source: string; target: string; targetHandle?: string | null }

const NOTE = 'note'
const created: string[] = []

async function seed(page: Page, title: string, nodes: CanvasNode[], edges: WorkflowEdge[]): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `zz-note-inputs ${title} ${Date.now()}-${randomUUID().slice(0, 6)}`,
      version: '1.0.0',
      description: 'Note inputs',
      workflow: { nodes, edges },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  const testId = (body?.data?.id ?? body?.id) as string
  created.push(testId)
  await openTest(page, testId)
  await page.locator('.react-flow__controls-fitview').click()
  await waitForViewportSettled(page)
  return testId
}

async function storedEdges(page: Page, testId: string): Promise<StoredEdge[]> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as { data?: { edges?: StoredEdge[] }; edges?: StoredEdge[] }
  return body.data?.edges ?? body.edges ?? []
}

function log(id: string, text: string, x: number, y: number) {
  return markerNode({ id, description: id, text, position: { x, y } })
}

function noteOn(page: Page): Locator {
  return page.locator(`[data-testid="note-node-${NOTE}"]`)
}

/** Where a drawn wire ends on the screen: the last point of its path. */
async function wireEnd(page: Page, edgeId: string): Promise<Point> {
  const path = page.locator(`[data-testid="rf__edge-${edgeId}"] path.react-flow__edge-path`)
  await expect(path, `the wire ${edgeId} is drawn`).toHaveCount(1)
  return path.evaluate((el) => {
    const p = el as SVGPathElement
    const end = p.getPointAtLength(p.getTotalLength())
    const matrix = p.getScreenCTM()
    if (!matrix) throw new Error('the wire has no screen matrix')
    const point = new DOMPoint(end.x, end.y).matrixTransform(matrix)
    return { x: point.x, y: point.y }
  })
}

async function expectWireEndsOn(page: Page, edgeId: string, dot: Locator, what: string): Promise<void> {
  const end = await wireEnd(page, edgeId)
  const box = (await dot.boundingBox()) as Box | null
  expect(box, `${what}: the dot is measurable`).not.toBeNull()
  const slack = 3
  const inside =
    end.x >= box!.x - slack &&
    end.x <= box!.x + box!.width + slack &&
    end.y >= box!.y - slack &&
    end.y <= box!.y + box!.height + slack
  expect(inside, `${what}: the wire ends at ${JSON.stringify(end)}, the dot is at ${JSON.stringify(box)}`).toBe(true)
}

/** The parts of a dot's look that make it read as an input: size, shape and fill. */
async function dotLook(dot: Locator): Promise<Record<string, string>> {
  return dot.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      width: style.width,
      height: style.height,
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
    }
  })
}

/** Press on `from`, drag the wire to `to` and hold it there; a few small moves let the canvas see the pointer settle. */
async function dragWireTo(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.waitForTimeout(200)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 20, { steps: 4 })
  await expect(page.locator('.react-flow__connection'), 'a wire is being dragged').toHaveCount(1, { timeout: 3_000 })
  await page.mouse.move(to.x, to.y, { steps: 15 })
  for (const dx of [1, -1, 1]) {
    await page.waitForTimeout(150)
    await page.mouse.move(to.x + dx, to.y)
  }
}

/** A point just above the middle of the Note's top edge. */
async function aboveNote(page: Page): Promise<Point> {
  const box = (await noteOn(page).boundingBox()) as Box | null
  expect(box, 'the Note is measurable').not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y - 8 }
}

/** Start, Log first, Note, Log after in a line; Log second beside them, nothing wired. */
function lineWithSpareBlock(): { nodes: CanvasNode[]; edges: WorkflowEdge[] } {
  return {
    nodes: [
      log('log-first', 'first', -75, 120),
      log('log-second', 'second', 360, 120),
      noteNode(NOTE, 'Where the paths meet', { x: -75, y: 360 }),
      log('log-after', 'after', -75, 600),
    ],
    edges: [
      { id: 'edge-start-log-first', source: 'start-node', target: 'log-first' },
      edge('log-first', NOTE),
      edge(NOTE, 'log-after'),
    ],
  }
}

test.describe('V-CTRL-NOTE-03: Note inputs', () => {
  test.afterEach(async ({ request }) => {
    await cleanUp(request, created)
  })

  test('S1: a Note where two paths join shows one input per wire, in both themes', async ({ page }) => {
    const ifElse = controlNode({
      id: 'if-else',
      label: 'If/Else',
      elementType: 'if-else',
      category: 'conditional',
      description: 'if else',
      values: {
        branches: [
          { type: 'if', id: 'branch_0', label: 'if', conditions: [{ type: 'expression', expression: 'True', id: 'if-c0' }] },
          { type: 'else', id: 'branch_1', label: 'else' },
        ],
      },
      position: { x: -75, y: 120 },
    })
    const testId = await seed(
      page,
      'join',
      [
        ifElse,
        log('log-if-path', 'if path', -300, 320),
        log('log-else-path', 'else path', 150, 320),
        noteNode(NOTE, 'Where the paths meet', { x: -75, y: 520 }),
        log('log-after', 'after', -75, 740),
      ],
      [
        { id: 'edge-start-if-else', source: 'start-node', target: 'if-else' },
        handleEdge('if-else', 'branch_0', 'log-if-path'),
        handleEdge('if-else', 'branch_1', 'log-else-path'),
        { id: 'edge-if-path-note', source: 'log-if-path', target: NOTE },
        { id: 'edge-else-path-note', source: 'log-else-path', target: NOTE, targetHandle: 'ingress_1' },
        edge(NOTE, 'log-after'),
      ],
    )
    const intoNote = (await storedEdges(page, testId)).filter((e) => e.target === NOTE)
    const ifWire = intoNote.find((e) => e.source === 'log-if-path')
    const elseWire = intoNote.find((e) => e.source === 'log-else-path')
    expect(ifWire, `the Test stores the if path wire into the Note: ${JSON.stringify(intoNote)}`).toBeDefined()
    expect(elseWire?.targetHandle, `the Test stores the else path wire on the Note's second input: ${JSON.stringify(intoNote)}`).toBe('ingress_1')

    const noteCard = noteOn(page)
    const first = noteCard.locator('[data-testid="note-handle-input"]')
    const second = noteCard.locator('[data-testid="note-handle-input-ingress_1"]')
    const blockDot = page.locator('[data-testid="workflow-node-log-after"] [data-testid="handle-input"]')

    await inBothThemes(page, async (theme) => {
      await expect(first, `${theme}: the Note shows its first input`).toBeVisible()
      await expect(second, `${theme}: the Note shows a second input for the second wire`).toBeVisible()
      await expect(noteCard.locator('.react-flow__handle-top'), `${theme}: one input per wire`).toHaveCount(2)

      const look = await dotLook(blockDot)
      expect(await dotLook(first), `${theme}: the first input looks like a Block's input`).toEqual(look)
      expect(await dotLook(second), `${theme}: the second input looks like a Block's input`).toEqual(look)

      await expectWireEndsOn(page, ifWire!.id, first, `${theme}: the if path wire`)
      await expectWireEndsOn(page, elseWire!.id, second, `${theme}: the else path wire`)
    })
  })

  test('S2: a wire dragged near a Note with one wire shows the + input and connects to it', async ({ page }) => {
    const graph = lineWithSpareBlock()
    const testId = await seed(page, 'plus', graph.nodes, graph.edges)
    const noteCard = noteOn(page)
    const addDot = noteCard.locator('[data-testid="note-handle-input-add"]')

    await expect(noteCard.locator('.react-flow__handle-top'), 'the Note starts with one input').toHaveCount(1)
    const from = await handleCenter(page.locator('[data-testid="workflow-node-log-second"] [data-testid="handle-output"]'))
    await dragWireTo(page, from, await aboveNote(page))

    await expect(addDot, 'the Note shows the green + input while the wire is near it').toBeVisible({ timeout: 5_000 })
    const plus = await handleCenter(addDot)
    await page.mouse.move(plus.x, plus.y, { steps: 5 })
    await page.waitForTimeout(150)
    await page.mouse.move(plus.x + 1, plus.y)
    await page.waitForTimeout(150)
    await page.mouse.move(plus.x, plus.y)
    await page.waitForTimeout(150)
    await expect(addDot, 'the + input is still offered under the pointer').toBeVisible()
    await page.mouse.up()

    const second = noteCard.locator('[data-testid="note-handle-input-ingress_1"]')
    await expect(second, 'the drop gives the Note a second input').toBeVisible({ timeout: 5_000 })
    await expect(addDot, 'the + input is gone after the drop').toHaveCount(0)
    await expect(noteCard.locator('.react-flow__handle-top'), 'the Note shows two inputs').toHaveCount(2)

    await saveTest(page)
    const intoNote = (await storedEdges(page, testId)).filter((e) => e.target === NOTE)
    const summary = JSON.stringify(intoNote)
    expect(intoNote, `two wires come into the Note: ${summary}`).toHaveLength(2)
    const kept = intoNote.find((e) => e.source === 'log-first')
    const added = intoNote.find((e) => e.source === 'log-second')
    expect(kept, `first -> Note is kept: ${summary}`).toBeDefined()
    expect(kept!.targetHandle ?? null, `first -> Note stays on the default input: ${summary}`).toBeNull()
    expect(added, `second -> Note is stored: ${summary}`).toBeDefined()
    expect(added!.targetHandle, `second -> Note is on the second input: ${summary}`).toBe('ingress_1')

    await expectWireEndsOn(page, added!.id, second, 'the new wire')
  })

  test('S3: a wire dragged from below a Note back to it shows the cycle mark and makes no wire', async ({ page }) => {
    const graph = lineWithSpareBlock()
    await seed(page, 'cycle', graph.nodes, graph.edges)
    const noteCard = noteOn(page)
    const cycleDot = noteCard.locator('[data-testid="note-handle-input-cycle"]')
    const wires = page.locator('.react-flow__edge')
    const wiresBefore = await wires.count()

    const from = await handleCenter(page.locator('[data-testid="workflow-node-log-after"] [data-testid="handle-output"]'))
    await dragWireTo(page, from, await aboveNote(page))

    await expect(cycleDot, 'the Note shows the cycle mark for a wire that would close a loop').toBeVisible({ timeout: 5_000 })
    await expect(noteCard.locator('[data-testid="note-handle-input-add"]'), 'no + input for a wire that would close a loop').toHaveCount(0)
    await page.mouse.up()

    await expect(cycleDot, 'the cycle mark is gone after the drop').toHaveCount(0)
    await expect(noteCard.locator('[data-testid="note-handle-input"]'), 'the Note keeps its input').toBeVisible()
    await expect(noteCard.locator('.react-flow__handle-top'), 'the Note keeps one input').toHaveCount(1)
    await expect(wires, 'the drop makes no wire').toHaveCount(wiresBefore)
  })
})
