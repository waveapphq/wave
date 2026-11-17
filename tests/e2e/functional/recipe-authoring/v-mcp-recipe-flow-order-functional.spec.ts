/**
 * V-MCP-RECIPE-FLOW-ORDER-FUNCTIONAL: a test an assistant changes over MCP still reads in flow
 * order, fast or watched, and a watched change glides the Blocks that make room before any new
 * Block appears.
 * Design Decisions: WATCH-8, WATCH-9
 * REQ: REQ-5.2.7.4, REQ-5.2.7.18
 *
 * The recipes are a release smoke check in three steps (`recipe-flow-order-step1.yaml` to
 * `-step3.yaml`): step 1 connects, checks Orders API inside a Remote Execution and, when it is
 * down, alerts On-Call and fails the test, then disconnects; step 2 adds a restart and a wait for
 * health on the If's other path; step 3 adds a release query and its check after the wait. The
 * order is read from the Block boxes the canvas draws.
 *
 * Pass Criteria:
 *  1. Fast: after step 1 (a fresh build), step 2 and step 3, made with create_test_from_recipe and
 *     amend_test_from_recipe, the canvas draws every Block one row under the Block before it in its
 *     lane, on that Block's column, with no Block between them; each lane of an If one row under
 *     the If, in a column of its own, left to right; the Block after a lane one row under its
 *     parent, with the lane at least one 80 px gutter left of it; no two Blocks overlapping; the
 *     wires of that flow; and every box at its stored place and width. "Fail test" sits one row
 *     right under "Alert On-Call", and "Wait for healthy" is not under the failure branch.
 *  2. Watched: with a tab that holds the test and a watching tab, amend_test_live_from_recipe with
 *     step 2 and then step 3 is amended and saves exactly the layout the fast amend of the same
 *     recipe saves on a twin test; both tabs then draw that layout, reading in order as in 1.
 *  3. In both tabs each watched change first glides the Blocks that make room (step 2: Check Orders
 *     API, Orders API down?, Alert On-Call, Fail test; step 3: Alert On-Call, Fail test, Check
 *     /health): the canvas reads data-mirror-glide="moving" while every one of them is drawn
 *     strictly between its old and its new place, the other Blocks hold still, and no new Block
 *     appears until the glide ends. Then the new Blocks appear one at a time, in flow order, each
 *     at its final place, while every Block that was there stays at its final place.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-flow-order-functional.spec.ts
 */

import fs from 'fs'
import path from 'path'
import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { cleanUp, storedTest } from '../../helpers/fn-block'
import { callTool, callToolAsync, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { SEL, ownershipState, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import { openHolder, openWatcher, recordView, uniqueName, viewSamples, type ViewSample } from '../watch-mode/helpers'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

const CONNECT = 'Connect to App Server'
const REMOTE = 'On App Server'
const CHECK = 'Check Orders API'
const DOWN = 'Orders API down?'
const ALERT = 'Alert On-Call'
const FAIL = 'Fail test'
const RESTART = 'Restart Orders API'
const WAIT = 'Wait for healthy'
const HEALTH = 'Check /health'
const QUERY = 'Query releases'
const VERIFY = 'Verify release'
const DISCONNECT = 'Disconnect'

// The layout's rules: rows of 140 px, the 32 px a row leaves under a card, the 80 px gutter.
const ROW = 140
const ROW_CLEARANCE = 32
const GUTTER = 80
const EPSILON = 0.5

type Step = 1 | 2 | 3

/** A Block of the flow, with the lanes under it or, with `beside`, its one lane beside the Blocks after it. */
interface FlowStep {
  label: string
  lanes?: FlowStep[][]
  beside?: boolean
}

interface Names {
  test: string
  appServer: string
  releaseDb: string
}

interface DrawnBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** What the canvas draws: each Block's box by its name, and each wire as `<from name>><to name>`. */
interface Drawn {
  boxes: Record<string, DrawnBox>
  wires: string[]
}

interface StoredPlace {
  id: string
  x: number
  y: number
  width: number
}

/** The stored test's Blocks by name. */
type StoredLayout = Record<string, StoredPlace>

const open: BrowserContext[] = []
const track = (context: BrowserContext): void => {
  open.push(context)
}
const createdTests: string[] = []
const createdProfiles: string[] = []

/** The flow each step builds, as the canvas must read it. */
function flowOf(step: Step): FlowStep[] {
  const wait: FlowStep = { label: WAIT, beside: step === 3, lanes: [[{ label: HEALTH }]] }
  const afterWait: FlowStep[] = step === 3 ? [{ label: QUERY }, { label: VERIFY }] : []
  const otherPath: FlowStep[] = step === 1 ? [] : [{ label: RESTART }, wait, ...afterWait]
  const down: FlowStep = {
    label: DOWN,
    lanes: [[{ label: ALERT }, { label: FAIL }], otherPath].filter((lane) => lane.length > 0),
  }
  return [{ label: CONNECT }, { label: REMOTE, beside: true, lanes: [[{ label: CHECK }, down]] }, { label: DISCONNECT }]
}

function labelsIn(chain: readonly FlowStep[]): string[] {
  return chain.flatMap((step) => [step.label, ...(step.lanes ?? []).flatMap(labelsIn)])
}

/** Every Block in the lanes under a Block. */
function inLanes(step: FlowStep): string[] {
  return (step.lanes ?? []).flatMap(labelsIn)
}

function lanesBelow(step: FlowStep): boolean {
  return (step.lanes?.length ?? 0) > 0 && !step.beside
}

/** The wires of the flow: into the first Block of each lane, and from each Block to the next in its lane. */
function flowWires(chain: readonly FlowStep[], parent: string | null = null): string[] {
  return chain.flatMap((step, index) => {
    const into = index > 0 ? [`${chain[index - 1].label}>${step.label}`] : parent ? [`${parent}>${step.label}`] : []
    return [...into, ...(step.lanes ?? []).flatMap((lane) => flowWires(lane, step.label))]
  })
}

/** A card's height plus the clearance, rounded up to whole rows. */
function rowStep(height: number): number {
  return Math.ceil((height + ROW_CLEARANCE) / ROW) * ROW
}

function centerOf(box: DrawnBox): number {
  return box.x + box.width / 2
}

function spanOf(boxes: Record<string, DrawnBox>, labels: readonly string[]): [number, number] {
  return [
    Math.min(...labels.map((label) => boxes[label].x)),
    Math.max(...labels.map((label) => boxes[label].x + boxes[label].width)),
  ]
}

function overlap(a: DrawnBox, b: DrawnBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Every place the drawn layout does not read in flow order; none when it does. */
function orderFindings(boxes: Record<string, DrawnBox>, flow: FlowStep[]): string[] {
  const findings: string[] = []
  const all = labelsIn(flow)
  const nextRow = (label: string): number => boxes[label].y + rowStep(boxes[label].height)

  const visit = (chain: FlowStep[], parent: FlowStep | null): void => {
    chain.forEach((step, index) => {
      const own = boxes[step.label]
      const previous = index > 0 ? chain[index - 1] : null
      const above = previous
        ? [previous.label, ...(lanesBelow(previous) ? inLanes(previous) : [])]
        : parent
          ? [parent.label]
          : []
      if (above.length > 0) {
        const row = Math.max(...above.map(nextRow))
        if (Math.abs(own.y - row) > EPSILON) {
          findings.push(`ROW: "${step.label}" at y=${own.y}, the flow puts it at y=${row}, one row under "${above.join('", "')}"`)
        }
      }
      if (previous) {
        const before = boxes[previous.label]
        const off = centerOf(own) - centerOf(before)
        if (Math.abs(off) > EPSILON) {
          findings.push(`COLUMN: "${step.label}" is ${off} px off the column of "${previous.label}"`)
        }
        const [left, right] = spanOf(boxes, [previous.label, step.label])
        const skip = new Set([step.label, previous.label, ...(lanesBelow(previous) ? inLanes(previous) : [])])
        for (const other of all.filter((label) => !skip.has(label))) {
          const box = boxes[other]
          if (box.y >= before.y + before.height && box.y < own.y && centerOf(box) >= left && centerOf(box) <= right) {
            findings.push(`BETWEEN: "${other}" sits between "${previous.label}" and "${step.label}"`)
          }
        }
      }
      const lanes = step.lanes ?? []
      if (lanesBelow(step)) {
        lanes.slice(1).forEach((lane, index) => {
          const leftEnds = spanOf(boxes, labelsIn(lanes[index]))[1]
          const rightStarts = spanOf(boxes, labelsIn(lane))[0]
          if (leftEnds > rightStarts + EPSILON) {
            findings.push(
              `LANES: lanes ${index + 1} and ${index + 2} of "${step.label}" share columns (x=${leftEnds} > x=${rightStarts})`,
            )
          }
        })
      }
      if (step.beside) {
        const laneEnds = spanOf(boxes, labelsIn(lanes[0]))[1]
        const restStarts = spanOf(boxes, labelsIn(chain.slice(index + 1)))[0]
        if (laneEnds + GUTTER > restStarts + EPSILON) {
          findings.push(
            `BESIDE: the lane of "${step.label}" ends at x=${laneEnds}, the Blocks after it start at x=${restStarts}`,
          )
        }
      }
      lanes.forEach((lane) => visit(lane, step))
    })
  }
  visit(flow, null)
  all.forEach((first, index) => {
    for (const second of all.slice(index + 1)) {
      if (overlap(boxes[first], boxes[second])) findings.push(`OVERLAP: "${first}" and "${second}"`)
    }
  })
  return findings
}

/** The Block boxes and wires the canvas draws, in canvas units. */
async function drawnCanvas(page: Page): Promise<Drawn> {
  return page.evaluate(() => {
    const nameOf = (id: string): string =>
      (document.querySelector(`[data-testid="workflow-node-body-${id}"]`)?.getAttribute('aria-label') ?? id).replace(
        / block$/,
        '',
      )
    const boxes: Record<string, { id: string; x: number; y: number; width: number; height: number }> = {}
    for (const card of document.querySelectorAll<HTMLElement>('[data-testid^="workflow-node-"][data-nodetype]')) {
      const id = (card.getAttribute('data-testid') ?? '').replace('workflow-node-', '')
      const place = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
        document.querySelector<HTMLElement>(`[data-testid="rf__node-${id}"]`)?.style.transform ?? '',
      )
      if (!place) throw new Error(`Block ${id} has no place on the canvas`)
      boxes[nameOf(id)] = {
        id,
        x: Number(place[1]) + card.offsetLeft,
        y: Number(place[2]) + card.offsetTop,
        width: card.offsetWidth,
        height: card.offsetHeight,
      }
    }
    const wires = [...document.querySelectorAll('[data-testid="workflow-canvas"] .react-flow__edge')]
      .map((wire) => /^Edge from (.+) to (.+)$/.exec(wire.getAttribute('aria-label') ?? ''))
      .filter((ends): ends is RegExpExecArray => ends !== null)
      .map((ends) => `${nameOf(ends[1])}>${nameOf(ends[2])}`)
      .sort()
    return { boxes, wires }
  })
}

/** The tab draws the flow's Blocks at their stored places, with the flow's wires, in flow order. */
async function expectReadsInOrder(page: Page, flow: FlowStep[], stored: StoredLayout, who: string): Promise<Drawn> {
  await expect
    .poll(async () => Object.keys((await drawnCanvas(page)).boxes).sort(), {
      timeout: 15_000,
      message: `${who} draws every Block of the flow`,
    })
    .toEqual(labelsIn(flow).sort())
  const drawn = await drawnCanvas(page)
  const detail = JSON.stringify(drawn.boxes)
  expect(
    Object.fromEntries(Object.entries(drawn.boxes).map(([label, box]) => [label, { id: box.id, x: box.x, y: box.y, width: box.width }])),
    `${who} draws every Block at its stored place and width`,
  ).toEqual(stored)
  expect(drawn.wires, `${who} draws the wires of the flow`).toEqual(expect.arrayContaining(flowWires(flow)))
  expect(orderFindings(drawn.boxes, flow), `${who} reads in flow order: ${detail}`).toEqual([])
  return drawn
}

function expectFailRightUnderAlert(drawn: Drawn): void {
  const alert = drawn.boxes[ALERT]
  const fail = drawn.boxes[FAIL]
  expect(
    { rowsDown: fail.y - alert.y, off: centerOf(fail) - centerOf(alert) },
    `"${FAIL}" sits one row right under "${ALERT}": ${JSON.stringify({ alert, fail })}`,
  ).toEqual({ rowsDown: rowStep(alert.height), off: 0 })
}

function expectWaitNotUnderTheFailureBranch(drawn: Drawn): void {
  const [left, right] = spanOf(drawn.boxes, [ALERT, FAIL])
  const wait = drawn.boxes[WAIT]
  expect(
    wait.x >= right || wait.x + wait.width <= left,
    `"${WAIT}" (x ${wait.x} to ${wait.x + wait.width}) is not under the failure branch (x ${left} to ${right})`,
  ).toBe(true)
}

/** Replace one text the fixture must hold. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`the fixture recipe has no "${from}"`)
  return text.replaceAll(from, to)
}

function recipeOf(step: Step, names: Names): string {
  const text = fs.readFileSync(path.resolve(__dirname, `recipe-flow-order-step${step}.yaml`), 'utf-8')
  const named = swap(text, '  name: Release smoke check\n', `  name: ${JSON.stringify(names.test)}\n`)
  const bound = swap(named, 'profile: App Server', `profile: ${JSON.stringify(names.appServer)}`)
  return step === 3 ? swap(bound, 'profile: Release DB', `profile: ${JSON.stringify(names.releaseDb)}`) : bound
}

function createProfile(name: string, config: Record<string, string>): void {
  const result = callTool(MCP_PORT, 'create_profile', { name, profile_type: 'custom', config })
  expect(result.isError, JSON.stringify(result.payload)).toBe(false)
  expect(result.payload.created, JSON.stringify(result.payload)).toBe(true)
  createdProfiles.push(String(result.payload.profile_id))
}

/** The two profiles the steps bind, under names of this run. */
function seedProfiles(): Pick<Names, 'appServer' | 'releaseDb'> {
  const names = { appServer: uniqueName('App Server'), releaseDb: uniqueName('Release DB') }
  const login = { username: 'user', password: 'secret' }
  createProfile(names.appServer, { host: 'app', port: '22', ...login })
  createProfile(names.releaseDb, { host: 'db', port: '5432', database: 'rel', ...login })
  return names
}

function createTest(names: Names): string {
  const result = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: recipeOf(1, names) })
  expect(result.isError, JSON.stringify(result.payload)).toBe(false)
  // A held workbench slot also arrives here as created:false, hence the payload.
  expect(result.payload.created, JSON.stringify(result.payload)).toBe(true)
  const testId = String(result.payload.test_id)
  createdTests.push(testId)
  return testId
}

function amendFast(testId: string, step: Step, names: Names): void {
  const result = callTool(MCP_PORT, 'amend_test_from_recipe', { test_ref: testId, recipe: recipeOf(step, names) })
  expect(result.isError, JSON.stringify(result.payload)).toBe(false)
  expect(result.payload.amended, JSON.stringify(result.payload)).toBe(true)
}

async function storedLayout(request: APIRequestContext, testId: string): Promise<StoredLayout> {
  const stored = await storedTest(request, testId)
  const nodes = (stored.workflow as { nodes: Array<Record<string, any>> }).nodes
  return Object.fromEntries(
    nodes.map((node) => [
      String(node.data.label),
      { id: String(node.id), x: node.position.x, y: node.position.y, width: node.width },
    ]),
  )
}

/** The glide is a motion effect, so each tab asks for motion explicitly. */
async function withMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
}

/** Open the test on a canvas of its own, check what it draws, and free the session again. */
async function checkOnCanvas(
  browser: Browser,
  request: APIRequestContext,
  testId: string,
  step: Step,
): Promise<Drawn> {
  const tab = await openHolder(browser, testId, track)
  const drawn = await expectReadsInOrder(tab, flowOf(step), await storedLayout(request, testId), `the canvas after step ${step}`)
  await tab.context().close()
  await resetOwnership(request)
  await request.delete(`${BACKEND_URL}/workbench/session/`)
  return drawn
}

function placeOf(sample: ViewSample, id: string): { x: number; y: number } {
  const place = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(sample.places[id] ?? '')
  if (!place) throw new Error(`Block ${id} has no place in the sample ${JSON.stringify(sample)}`)
  return { x: Number(place[1]), y: Number(place[2]) }
}

function idsOf(sample: ViewSample): string[] {
  return sample.blocks.map((block) => block.split('=')[0]).sort()
}

/** On the way: strictly between the two places on every axis it moves along, and still on the others. */
function between(place: { x: number; y: number }, from: StoredPlace, to: StoredPlace): boolean {
  const axis = (at: number, start: number, end: number): boolean =>
    start === end ? at === start : at > Math.min(start, end) && at < Math.max(start, end)
  return axis(place.x, from.x, to.x) && axis(place.y, from.y, to.y)
}

/** A watched change, as one tab recorded it: the glide of the Blocks that make room, then the new Blocks one at a time. */
function expectGlideThenAdd(
  samples: ViewSample[],
  before: StoredLayout,
  after: StoredLayout,
  movers: string[],
  added: string[],
  who: string,
): void {
  const detail = JSON.stringify(samples)
  const kept = Object.keys(before)
  const keptIds = kept.map((label) => before[label].id).sort()
  const at = (label: string): { x: number; y: number } => ({ x: after[label].x, y: after[label].y })
  expect(
    kept.filter((label) => before[label].x !== after[label].x || before[label].y !== after[label].y).sort(),
    'the Blocks the change moves to make room',
  ).toEqual([...movers].sort())

  const gliding = samples.flatMap((sample, index) => (sample.glide === '' ? [] : [index]))
  expect(gliding.length, `${who} glides the Blocks that make room: ${detail}`).toBeGreaterThan(0)
  const [first, last] = [gliding[0], gliding[gliding.length - 1]]
  expect(gliding, `${who} glides once, in one run of frames: ${detail}`).toEqual(
    Array.from({ length: last - first + 1 }, (_, offset) => first + offset),
  )
  const glide = samples.slice(first, last + 1)
  expect(
    glide.some(
      (sample) =>
        sample.glide === 'moving' &&
        movers.every((label) => between(placeOf(sample, before[label].id), before[label], after[label])),
    ),
    `${who} draws every moving Block on its way, between its old and new place, while the canvas reads "moving": ${detail}`,
  ).toBe(true)
  for (const sample of samples.slice(0, last + 1)) {
    expect(idsOf(sample), `${who} shows no new Block before the glide ends: ${detail}`).toEqual(keptIds)
    for (const label of kept.filter((name) => !movers.includes(name))) {
      expect(placeOf(sample, before[label].id), `${who} holds "${label}" still: ${detail}`).toEqual(at(label))
    }
  }

  const rest = samples.slice(last + 1)
  expect(rest.length, `${who} plays on after the glide: ${detail}`).toBeGreaterThan(0)
  for (const sample of rest) {
    for (const label of kept) {
      expect(placeOf(sample, before[label].id), `${who} keeps "${label}" at its final place: ${detail}`).toEqual(at(label))
    }
  }
  const counts = [keptIds.length, ...rest.map((sample) => sample.count)]
  expect(
    counts.slice(1).map((count, index) => count - counts[index]).filter((step) => step !== 0),
    `${who} adds the new Blocks one at a time: ${detail}`,
  ).toEqual(added.map(() => 1))
  const appeared: string[] = []
  for (const sample of rest) {
    appeared.push(...idsOf(sample).filter((id) => !keptIds.includes(id) && !appeared.includes(id)))
  }
  expect(appeared, `${who} adds the new Blocks in flow order: ${detail}`).toEqual(added.map((label) => after[label].id))
  for (const label of added) {
    const id = after[label].id
    const arrival = rest.find((sample) => idsOf(sample).includes(id)) as ViewSample
    expect(placeOf(arrival, id), `${who} brings "${label}" in at its final place: ${detail}`).toEqual(at(label))
  }
}

test.describe('V-MCP-RECIPE-FLOW-ORDER-FUNCTIONAL: a changed test reads in flow order, fast or watched', () => {
  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
    await cleanUp(request, createdTests)
    for (const id of createdProfiles.splice(0)) {
      await request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => undefined)
    }
    await resetMcpSettings(page)
  })

  test('a fast change keeps the test in flow order on the canvas, step after step', async ({ browser, page, request }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const names = { test: uniqueName('Release smoke check'), ...seedProfiles() }
    const testId = createTest(names)

    await test.step('step 1, a fresh build, reads in flow order', async () => {
      expectFailRightUnderAlert(await checkOnCanvas(browser, request, testId, 1))
    })

    await test.step('step 2 adds a restart and a wait on the If\'s other path, in a column of its own', async () => {
      amendFast(testId, 2, names)
      const drawn = await checkOnCanvas(browser, request, testId, 2)
      expectFailRightUnderAlert(drawn)
      expectWaitNotUnderTheFailureBranch(drawn)
    })

    await test.step('step 3 adds a query and its check one row under the wait, beside its retry lane', async () => {
      amendFast(testId, 3, names)
      const drawn = await checkOnCanvas(browser, request, testId, 3)
      expectFailRightUnderAlert(drawn)
      expectWaitNotUnderTheFailureBranch(drawn)
    })
  })

  test('a watched change glides the Blocks that make room, then adds the new ones one at a time, and saves the fast layout', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const bound = seedProfiles()
    const names = { test: uniqueName('Release smoke check'), ...bound }
    const twinNames = { test: uniqueName('Release smoke check twin'), ...bound }

    // The twin takes the fast change of each step, before any tab holds the session.
    const twinId = createTest(twinNames)
    amendFast(twinId, 2, twinNames)
    const fastTwo = await storedLayout(request, twinId)
    amendFast(twinId, 3, twinNames)
    const fastThree = await storedLayout(request, twinId)
    const testId = createTest(names)

    const holder = await openHolder(browser, testId, track, withMotion)
    const watcher = await openWatcher(browser, track, withMotion)
    await expect(watcher.locator(SEL.bannerPerson)).toBeVisible()
    const gaveWay = await waitUntilHeld(request)
    expect(gaveWay.kind).toBe('person')
    const tabs = [
      [holder, 'the tab that gives way'],
      [watcher, 'the watching tab'],
    ] as const
    for (const [tab, who] of tabs) await expectReadsInOrder(tab, flowOf(1), await storedLayout(request, testId), who)

    for (const { step, fast, movers, added } of [
      { step: 2 as const, fast: fastTwo, movers: [CHECK, DOWN, ALERT, FAIL], added: [RESTART, WAIT, HEALTH] },
      { step: 3 as const, fast: fastThree, movers: [ALERT, FAIL, HEALTH], added: [QUERY, VERIFY] },
    ]) {
      await test.step(`the watched change of step ${step}`, async () => {
        const before = await storedLayout(request, testId)
        for (const [tab] of tabs) {
          await recordView(tab)
          await expect.poll(async () => (await viewSamples(tab)).length).toBeGreaterThan(0)
        }

        const result = await callToolAsync(MCP_PORT, 'amend_test_live_from_recipe', {
          test_ref: testId,
          recipe: recipeOf(step, names),
        })
        expect(result.isError, JSON.stringify(result.payload)).toBe(false)
        expect(result.payload.amended, JSON.stringify(result.payload)).toBe(true)

        const after = await storedLayout(request, testId)
        const byName = (layout: StoredLayout): Record<string, Omit<StoredPlace, 'id'>> =>
          Object.fromEntries(Object.entries(layout).map(([label, { x, y, width }]) => [label, { x, y, width }]))
        expect(byName(after), 'the watched change saves the layout the fast change of the same recipe saves').toEqual(
          byName(fast),
        )

        await expect
          .poll(async () => (await ownershipState(request)).holder?.id, { timeout: 15_000 })
          .toBe(gaveWay.id)
        await expect(watcher.locator(SEL.bannerPerson)).toBeVisible()
        for (const [tab, who] of tabs) {
          const drawn = await expectReadsInOrder(tab, flowOf(step), after, who)
          expectFailRightUnderAlert(drawn)
          expectWaitNotUnderTheFailureBranch(drawn)
          expectGlideThenAdd(await viewSamples(tab), before, after, movers, added, who)
        }
      })
    }
  })
})
