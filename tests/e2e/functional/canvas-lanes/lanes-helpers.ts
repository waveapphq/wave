/** Canvas-built lanes (V-CANVAS-LANES-FUNCTIONAL): seed, build links the three user ways, save, run. */

import { expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  clickNodeKebabItem,
  dragPaletteItemToCanvas,
  dragSourceToCanvas,
  expandPalette,
  waitForCanvasBoxStable,
  waitForViewportSettled,
  type PaletteDragSpec,
} from '../../helpers/canvas'
import { openTest } from '../../helpers/fn-seed'
import { configSheet, selectEnvironment } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'
import {
  BACKEND_URL,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
  ensureEnvironment,
} from '../../helpers/config'
import { injectServiceHost } from '../../helpers/fixture-import'
import { formatEntries, getLogEntries, type LogEntry } from '../../helpers/log-reader'
import { QUICK_ADD_INPUT, QUICK_ADD_POPOVER } from '../../helpers/quick-add'
import {
  controlNode,
  markerNode,
  parallelNode,
  pluginNode,
  remoteExecutionNode,
  sshSessionOpenNode,
  tryCatchNode,
  type NodePosition,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'

/** Room for three control instances side by side at a readable zoom. */
export const LANE_VIEWPORT = { width: 1600, height: 1000 }

const START = 'start-node'
const NODES = '[data-testid^="workflow-node-"][data-nodetype]'
/** Screen pixels between a lane dot and the point a block is dropped at. */
const DROP_GAP_PX = 16

export type Method = 'drop' | 'quick' | 'drag'
export const METHODS: readonly Method[] = ['drop', 'quick', 'drag']

export interface SavedEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export interface SeedSpec {
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables?: Record<string, unknown>
  /** Rewrite the SSH host sentinel for the stack's sshd. */
  ssh?: boolean
}

/** Create the Test through `POST /tests` and return its id. */
export async function seedTest(request: APIRequestContext, spec: SeedSpec): Promise<string> {
  await ensureEnvironment(request)
  let fixture: Record<string, unknown> = {
    name: `${spec.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: spec.name,
    workflow: { nodes: spec.nodes, edges: spec.edges },
    variables: spec.variables ?? {},
    metadata: {},
  }
  if (spec.ssh) fixture = injectServiceHost(fixture)
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return (body.data?.id ?? body.id) as string
}

export async function deleteTest(request: APIRequestContext, testId: string | undefined): Promise<void> {
  if (!testId) return
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

export async function savedEdges(request: APIRequestContext, testId: string): Promise<SavedEdge[]> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return ((body.data ?? body).workflow?.edges ?? []) as SavedEdge[]
}

export function edge(source: string, target: string, sourceHandle?: string): WorkflowEdge {
  const e: WorkflowEdge = { id: `edge-${source}-${target}`, source, target }
  if (sourceHandle) e.sourceHandle = sourceHandle
  return e
}

export function intVar(value = 0): Record<string, unknown> {
  return { value, type: 'integer', scope: 'test' }
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/** Open the Test on a clean session with the environment picked and the canvas as large as it gets. */
export async function openLaneCanvas(page: Page, testId: string): Promise<void> {
  await openTest(page, testId)
  await selectEnvironment(page)
  const sidebar = page.getByRole('button', { name: 'Collapse sidebar' })
  if ((await sidebar.count()) > 0) await sidebar.first().click()
  const manager = page.locator('button[aria-label="Collapse Variable Manager"]')
  if ((await manager.count()) > 0) {
    await manager.first().click()
    await expect(page.locator('[data-testid="variable-manager"]')).toHaveAttribute('data-state', 'collapsed')
  }
  await expandPalette(page)
  await waitForCanvasBoxStable(page)
  await page.locator('.react-flow__controls-fitview').click()
  await waitForViewportSettled(page)
}

export function nodeLocator(page: Page, id: string): Locator {
  return page.locator(`[data-testid="workflow-node-${id}"]`)
}

/** The lane dot a link leaves from; `null` is a block's single exit. */
export function laneDot(page: Page, id: string, handle: string | null): Locator {
  const testid = handle === null ? 'handle-output' : `handle-output-${handle}`
  return nodeLocator(page, id).locator(`[data-testid="${testid}"]`)
}

export function inputDot(page: Page, id: string): Locator {
  return nodeLocator(page, id).locator('[data-testid="handle-input"]')
}

export async function canvasNodeIds(page: Page): Promise<string[]> {
  return page
    .locator(NODES)
    .evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace('workflow-node-', '')))
}

async function onlyNewNode(page: Page, before: readonly string[]): Promise<string> {
  const added = (await canvasNodeIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one block was added').toHaveLength(1)
  return added[0]
}

async function boxOf(locator: Locator, what: string) {
  await expect(locator, `${what} must be on the canvas`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${what} must have a box`).not.toBeNull()
  return box!
}

/** Canvas-relative point at a flow position, read off the live viewport transform. */
export async function flowToCanvas(page: Page, flow: NodePosition): Promise<NodePosition> {
  const transform = await page
    .locator('[data-testid="workflow-canvas"] .react-flow__viewport')
    .evaluate((el) => (el as HTMLElement).style.transform)
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(transform)
  expect(match, `viewport transform "${transform}"`).not.toBeNull()
  const [, tx, ty, scale] = match!.map(Number)
  return { x: tx + flow.x * scale, y: ty + flow.y * scale }
}

/** Drop a palette block just below a lane dot (offset `dx` screen pixels); returns the new block id. */
export async function dropBelow(
  page: Page,
  sourceId: string,
  handle: string | null,
  block: PaletteDragSpec = 'log',
  dx = 0,
): Promise<string> {
  const dot = await boxOf(laneDot(page, sourceId, handle), `lane ${handle ?? 'exit'} of ${sourceId}`)
  const canvas = await boxOf(page.locator('[data-testid="workflow-canvas"]'), 'the canvas')
  const before = await canvasNodeIds(page)
  await dragPaletteItemToCanvas(page, block, {
    x: dot.x + dot.width / 2 + dx - canvas.x,
    y: dot.y + dot.height + DROP_GAP_PX - canvas.y,
  })
  return onlyNewNode(page, before)
}

/** Drop a palette block just below a block's bottom edge (for a block with no exit dot); returns the new block id. */
export async function dropBelowBlock(page: Page, id: string, block: PaletteDragSpec = 'log'): Promise<string> {
  const node = await boxOf(nodeLocator(page, id), `block ${id}`)
  const canvas = await boxOf(page.locator('[data-testid="workflow-canvas"]'), 'the canvas')
  const before = await canvasNodeIds(page)
  await dragPaletteItemToCanvas(page, block, {
    x: node.x + node.width / 2 - canvas.x,
    y: node.y + node.height + DROP_GAP_PX - canvas.y,
  })
  return onlyNewNode(page, before)
}

/** Drop a palette block (or a drag source) at a flow position; returns the new block id. */
export async function dropAt(page: Page, block: PaletteDragSpec | Locator, flow: NodePosition): Promise<string> {
  const point = await flowToCanvas(page, flow)
  const before = await canvasNodeIds(page)
  if (typeof block === 'string' || 'term' in block) await dragPaletteItemToCanvas(page, block, point)
  else await dragSourceToCanvas(page, block, point)
  return onlyNewNode(page, before)
}

/** Select a block the way a click does. */
export async function selectBlock(page: Page, id: string): Promise<void> {
  const node = nodeLocator(page, id)
  await expect(async () => {
    await node.locator('button').first().dispatchEvent('click')
    await expect(node).toHaveAttribute('data-selected', 'true', { timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

export interface QuickRow {
  query: string
  row: string
}

const QUICK_LOG: QuickRow = { query: 'log', row: 'log' }

/** Quick Insert with `anchorId` selected (Ctrl+Space, the query, Enter); returns the new block id. */
export async function quickAddAfter(page: Page, anchorId: string, item: QuickRow = QUICK_LOG): Promise<string> {
  await selectBlock(page, anchorId)
  const before = await canvasNodeIds(page)
  await page.keyboard.press('Control+Space')
  await expect(page.locator(QUICK_ADD_POPOVER)).toBeVisible({ timeout: 5_000 })
  await page.locator(QUICK_ADD_INPUT).fill(item.query)
  await expect(page.locator(`[data-testid="quick-add-item-${item.row}"]`)).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page.locator(QUICK_ADD_POPOVER)).toHaveCount(0)
  return onlyNewNode(page, before)
}

export async function quickAddLogAfter(page: Page, anchorId: string): Promise<string> {
  return quickAddAfter(page, anchorId, QUICK_LOG)
}

/** Drag a link from one dot to another the way a pointer does; retried only while no link landed. */
export async function dragLink(page: Page, from: Locator, to: Locator, landed: Locator): Promise<void> {
  await expect(async () => {
    if ((await landed.count()) > 0) return
    const a = await boxOf(from, 'the source dot')
    const b = await boxOf(to, 'the target dot')
    const ax = a.x + a.width / 2
    const ay = a.y + a.height / 2
    await page.mouse.move(ax, ay)
    await page.waitForTimeout(250)
    await page.mouse.down()
    await page.mouse.move(ax, ay + 20, { steps: 4 })
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 })
    await page.waitForTimeout(300)
    await page.mouse.up()
    await expect(landed).toHaveCount(1, { timeout: 2000 })
  }).toPass({ timeout: 20_000 })
}

export function edgeOnCanvas(page: Page, source: string, target: string): Locator {
  return page.getByRole('group', { name: `Edge from ${source} to ${target}`, exact: true })
}

export function edgesFrom(page: Page, source: string): Locator {
  return page.locator(`.react-flow__edge[aria-label^="Edge from ${source} to "]`)
}

/** Link `source` (lane `handle`) to `target` by dragging from the lane dot to the target's input. */
export async function dragFromLane(page: Page, source: string, handle: string | null, target: string): Promise<void> {
  await dragLink(page, laneDot(page, source, handle), inputDot(page, target), edgeOnCanvas(page, source, target))
}

/** The link is on the canvas and its line leaves from the lane's own dot. */
export async function expectDrawnFromLane(
  page: Page,
  source: string,
  handle: string | null,
  target: string,
): Promise<void> {
  const lane = handle ?? 'exit'
  const drawn = edgeOnCanvas(page, source, target)
  await expect.soft(drawn, `a link ${source} -> ${target} is drawn (lane ${lane})`).toHaveCount(1)
  if ((await drawn.count()) !== 1) return
  const start = await drawn.locator('path.react-flow__edge-path').evaluate((path) => {
    const svgPath = path as SVGPathElement
    const point = svgPath.getPointAtLength(0)
    const matrix = svgPath.getScreenCTM()
    const screen = matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix) : point
    return { x: screen.x, y: screen.y }
  })
  const dot = await boxOf(laneDot(page, source, handle), `lane ${lane} of ${source}`)
  const expected = { x: dot.x + dot.width / 2, y: dot.y + dot.height }
  expect
    .soft(
      Math.hypot(start.x - expected.x, start.y - expected.y),
      `the ${source} -> ${target} line starts at the ${lane} dot (${JSON.stringify(expected)}), not at ${JSON.stringify(start)}`,
    )
    .toBeLessThanOrEqual(2)
}

/** The saved Test holds exactly one `source` -> `target` link and it names `handle` (none for a single exit). */
export function expectSavedLane(edges: readonly SavedEdge[], source: string, handle: string | null, target: string): void {
  const matching = edges.filter((e) => e.source === source && e.target === target)
  const summary = JSON.stringify(edges.filter((e) => e.source === source).map((e) => [e.sourceHandle ?? null, e.target]))
  expect.soft(matching, `saved ${source} -> ${target} (links from ${source}: ${summary})`).toHaveLength(1)
  if (matching.length !== 1) return
  expect
    .soft(matching[0].sourceHandle ?? null, `saved ${source} -> ${target} names lane ${handle ?? 'none'}`)
    .toBe(handle)
}

/** Open a block's config sheet from its cog. */
export async function openConfig(page: Page, id: string): Promise<Locator> {
  const sheet = configSheet(page)
  const configure = nodeLocator(page, id).locator('[data-testid="node-configure"]')
  await expect(async () => {
    await configure.dispatchEvent('click')
    await expect(sheet).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  return sheet
}

export async function saveConfig(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(sheet).toHaveCount(0)
}

/** Set a Log's message through its config sheet. */
export async function setLogText(page: Page, id: string, text: string): Promise<void> {
  const sheet = await openConfig(page, id)
  await setStringParam(sheet, page, 'message', text)
  await saveConfig(sheet)
}

export async function disableBlock(page: Page, id: string): Promise<void> {
  await clickNodeKebabItem(page, id, 'Disable')
  await expect(nodeLocator(page, id)).toHaveAttribute('data-disabled', 'true')
}

/** Toolbar Save; a blocked save leaves the button enabled and fails here. */
export async function saveCanvas(page: Page): Promise<void> {
  const save = page.locator('[data-testid="toolbar-save-button"]')
  await expect(save).toBeEnabled({ timeout: 10_000 })
  await save.click()
  await expect(save, 'the Test saved (no blocking dialog)').toBeDisabled({ timeout: 15_000 })
}

/** Press Run and wait for the run to pass; returns the console entries. */
export async function runToPass(page: Page): Promise<LogEntry[]> {
  const status = page.locator('[data-testid="workflow-status"]')
  await page.locator('[data-testid="run-button"]').click()
  await expect(status).toHaveAttribute('data-status', /passed|failed|stopped|skipped/, { timeout: 120_000 })
  const entries = await getLogEntries(page)
  expect(await status.getAttribute('data-status'), `the run passes.\n${formatEntries(entries)}`).toBe('passed')
  return entries
}

/** The console holds exactly `expected` among the texts it could hold (order-free, counts exact). */
export function expectLogTexts(entries: readonly LogEntry[], expected: readonly string[]): void {
  const known = new Set(expected)
  const seen = entries.map((e) => e.message).filter((m) => known.has(m))
  expect.soft([...seen].sort(), `console Log texts.\n${formatEntries(entries)}`).toEqual([...expected].sort())
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export function expr(id: string, expression: string): Record<string, unknown> {
  return { type: 'expression', expression, id }
}

export function logBlock(id: string, text: string, position: NodePosition): WorkflowNode {
  return markerNode({ id, description: id, text, position })
}

/** A Log that raises when it runs. */
export function failBlock(id: string, position: NodePosition): WorkflowNode {
  return pluginNode({
    id,
    label: 'Log',
    elementType: 'log',
    category: 'system',
    description: id,
    expressionFields: ['message'],
    values: { message: '1/0', level: 'INFO' },
    position,
  })
}

export function counterBlock(id: string, counter: string, position: NodePosition): WorkflowNode {
  return controlNode({
    id,
    label: 'Variable Setter',
    elementType: 'variable-setter',
    category: 'flow',
    description: id,
    values: { variables: { [counter]: `${counter} + 1` } },
    variableExpressionKeys: [counter],
    position,
  })
}

export function forBlock(id: string, count: number, indexVar: string | null, position: NodePosition): WorkflowNode {
  return controlNode({
    id,
    label: 'For Loop',
    elementType: 'for',
    category: 'loop',
    description: id,
    values: { mode: 'count', count, start: 0, end: 0 },
    outputBindings: indexVar ? { index: indexVar } : {},
    position,
  })
}

export function haltBlock(id: string, position: NodePosition): WorkflowNode {
  return controlNode({
    id,
    label: 'Halt',
    elementType: 'halt',
    category: 'flow',
    description: id,
    values: { scope: 'test', status: 'passed', message: `${id} halted` },
    position,
  })
}

export function sshOpenBlock(id: string, sessionVar: string, position: NodePosition): WorkflowNode {
  return sshSessionOpenNode({
    id,
    description: id,
    values: {
      host: SSH_FIXTURE_HOST_SENTINEL,
      port: Number(SSH_MAIN_PORT),
      username: SSH_STACK_USER,
      password: SSH_STACK_PASSWORD,
      host_key_verification: 'disabled',
      connect_timeout: 30,
    },
    outputBindings: { session_id: sessionVar },
    position,
  })
}

export { controlNode, parallelNode, remoteExecutionNode, tryCatchNode }

// ---------------------------------------------------------------------------
// One control, every lane, three ways
// ---------------------------------------------------------------------------

export interface LaneDef {
  /** Handle id; `null` is a single exit. */
  handle: string | null
  /** Suffix of the lane Log's text. */
  name: string
  /** Times the lane Log runs in one run. */
  runs: number
  /** The lane Log then links on to the method's counter or failing block. */
  onward?: 'count' | 'fail'
}

export interface MethodVars {
  index: string
  counter: string
}

export interface ControlCell {
  /** Short key: prefixes every block id and Log text. */
  key: string
  title: string
  lanes: LaneDef[]
  /** Iterations of the For that wraps each instance. */
  rounds: number
  /** Two-lane controls take both drops under the first dot; wider ones one drop under each dot. */
  dropAt: 'each-lane' | 'first-lane'
  control: (id: string, vars: MethodVars, position: NodePosition) => WorkflowNode
  /** Seeded blocks between Start and the first wrapper. */
  prelude?: WorkflowNode[]
  variables?: Record<string, unknown>
  ssh?: boolean
}

export function laneText(key: string, method: Method, lane: LaneDef): string {
  return `${key}-${method}-${lane.name}`
}

interface Instance {
  method: Method
  control: string
  onward?: string
  targets: Map<string, string>
}

/** One For-wrapped instance per method, every lane built its way, then drawn, saved and run checks. */
export async function buildEveryLane(page: Page, request: APIRequestContext, cell: ControlCell): Promise<void> {
  const width = Math.max(480, cell.lanes.length * 130 + 120)
  const nodes: WorkflowNode[] = [...(cell.prelude ?? [])]
  const edges: WorkflowEdge[] = []
  const variables: Record<string, unknown> = { ...(cell.variables ?? {}) }
  const instances: Instance[] = []
  const needs = (kind: 'count' | 'fail') => cell.lanes.some((lane) => lane.onward === kind)

  let previous: { id: string; handle?: string } = { id: START }
  for (const block of cell.prelude ?? []) {
    edges.push(edge(previous.id, block.id, previous.handle))
    previous = { id: block.id }
  }
  METHODS.forEach((method, column) => {
    const x0 = column * width
    const vars: MethodVars = { index: `i_${method}`, counter: `n_${method}` }
    variables[vars.index] = intVar()
    variables[vars.counter] = intVar()
    const wrapper = forBlock(`${cell.key}-${method}-for`, cell.rounds, vars.index, { x: x0, y: 0 })
    const control = cell.control(`${cell.key}-${method}`, vars, { x: x0, y: 160 })
    nodes.push(wrapper, control)
    edges.push(edge(previous.id, wrapper.id, previous.handle), edge(wrapper.id, control.id, 'body'))
    previous = { id: wrapper.id, handle: 'then' }

    const instance: Instance = { method, control: control.id, targets: new Map() }
    if (needs('count') || needs('fail')) {
      const onwardId = `${cell.key}-${method}-onward`
      const position = { x: x0 + 150, y: 500 }
      nodes.push(needs('count') ? counterBlock(onwardId, vars.counter, position) : failBlock(onwardId, position))
      instance.onward = onwardId
    }
    if (method === 'drag') {
      cell.lanes.forEach((lane, i) => {
        const id = `${cell.key}-drag-${lane.name}`
        nodes.push(logBlock(id, laneText(cell.key, 'drag', lane), { x: x0 + i * 130, y: 340 }))
        if (lane.onward) edges.push(edge(id, instance.onward!))
        instance.targets.set(lane.name, id)
      })
    }
    instances.push(instance)
  })
  const done = logBlock(`${cell.key}-done`, `${cell.key}-done`, { x: 0, y: 640 })
  nodes.push(done)
  edges.push(edge(previous.id, done.id, previous.handle))

  const testId = await seedTest(request, { name: `V-CANVAS-LANES ${cell.title}`, nodes, edges, variables, ssh: cell.ssh })
  try {
    await openLaneCanvas(page, testId)

    for (const instance of instances) {
      for (const lane of cell.lanes) {
        if (instance.method === 'drag') {
          await dragFromLane(page, instance.control, lane.handle, instance.targets.get(lane.name)!)
        } else {
          const under = cell.dropAt === 'first-lane' ? cell.lanes[0] : lane
          const id =
            instance.method === 'drop'
              ? await dropBelow(page, instance.control, under.handle)
              : await quickAddLogAfter(page, instance.control)
          instance.targets.set(lane.name, id)
          await setLogText(page, id, laneText(cell.key, instance.method, lane))
          if (lane.onward) {
            await dragLink(page, laneDot(page, id, null), inputDot(page, instance.onward!), edgeOnCanvas(page, id, instance.onward!))
          }
        }
        await expectDrawnFromLane(page, instance.control, lane.handle, instance.targets.get(lane.name)!)
      }
      await expect
        .soft(edgesFrom(page, instance.control), `${instance.control} carries one link per lane`)
        .toHaveCount(cell.lanes.length)
    }

    await saveCanvas(page)
    const saved = await savedEdges(request, testId)
    for (const instance of instances) {
      for (const lane of cell.lanes) {
        expectSavedLane(saved, instance.control, lane.handle, instance.targets.get(lane.name)!)
      }
      expect
        .soft(saved.filter((e) => e.source === instance.control), `saved links from ${instance.control}`)
        .toHaveLength(cell.lanes.length)
    }

    const entries = await runToPass(page)
    const expected: string[] = [`${cell.key}-done`]
    for (const method of METHODS) {
      for (const lane of cell.lanes) {
        for (let n = 0; n < lane.runs; n++) expected.push(laneText(cell.key, method, lane))
      }
    }
    expectLogTexts(entries, expected)
  } finally {
    await deleteTest(request, testId)
  }
}

// ---------------------------------------------------------------------------
// Blocks dropped from the palette, wired by drop and Quick Insert, saved disabled
// ---------------------------------------------------------------------------

export interface PaletteBlock {
  name: string
  /** A palette item, or the palette's New Function handle. */
  spec: PaletteDragSpec | 'new-function'
  /** Lanes the fresh block draws, in order; `[null]` is a single exit. */
  lanes: Array<string | null>
  /** Unconfigured blocks are saved disabled (required settings are not checked on a disabled block). */
  disable: boolean
}

const QUICK_HALT: QuickRow = { query: 'halt', row: 'halt' }
const GRID_COLUMNS = 4

async function placeFromPalette(page: Page, block: PaletteBlock, flow: NodePosition): Promise<string> {
  if (block.spec === 'new-function') {
    return dropAt(page, page.locator('[data-testid="palette-new-block-button"]'), flow)
  }
  return dropAt(page, block.spec, flow)
}

/** Seed an empty Test whose Start link is taken and whose corners give the canvas a fixed fit. */
async function seedGrid(request: APIRequestContext, title: string, rows: number, pitch: NodePosition): Promise<string> {
  return seedTest(request, {
    name: `V-CANVAS-LANES ${title}`,
    nodes: [
      haltBlock('corner-a', { x: -50, y: 140 }),
      haltBlock('corner-b', { x: GRID_COLUMNS * pitch.x + 40, y: rows * pitch.y + 20 }),
    ],
    edges: [edge(START, 'corner-a')],
  })
}

/** Each block from the palette, a linked Halt dropped under its exit and a second Halt that stays unlinked. */
export async function wireSingleExits(
  page: Page,
  request: APIRequestContext,
  title: string,
  blocks: readonly PaletteBlock[],
): Promise<void> {
  const perTest = GRID_COLUMNS * 2
  const pitch = { x: 330, y: 330 }
  for (let first = 0; first < blocks.length; first += perTest) {
    const batch = blocks.slice(first, first + perTest)
    const testId = await seedGrid(request, `${title} ${first / perTest + 1}`, 2, pitch)
    try {
      await openLaneCanvas(page, testId)
      const placed: Array<{ block: PaletteBlock; id: string; linked: string; unlinked: string }> = []
      for (const [i, block] of batch.entries()) {
        const cell = { x: 150 + (i % GRID_COLUMNS) * pitch.x, y: 40 + Math.floor(i / GRID_COLUMNS) * pitch.y }
        const id = await placeFromPalette(page, block, cell)
        await expect(laneDot(page, id, null), `${block.name} draws one exit dot`).toHaveCount(1)
        const linked = await dropBelow(page, id, null, 'halt', -45)
        await expect.soft(edgesFrom(page, id), `${block.name}: the drop below its exit links it`).toHaveCount(1)
        await expectDrawnFromLane(page, id, null, linked)
        const unlinked = await dropBelow(page, id, null, 'halt', 30)
        await expect.soft(edgesFrom(page, id), `${block.name}: a second drop adds no second link`).toHaveCount(1)
        await expect.soft(edgeOnCanvas(page, id, unlinked), `${block.name}: the second Halt stays unlinked`).toHaveCount(0)
        if (block.disable) await disableBlock(page, id)
        placed.push({ block, id, linked, unlinked })
      }
      await saveCanvas(page)
      const saved = await savedEdges(request, testId)
      for (const { block, id, linked, unlinked } of placed) {
        expectSavedLane(saved, id, null, linked)
        expect.soft(saved.filter((e) => e.source === id), `${block.name}: one saved link`).toHaveLength(1)
        expect.soft(saved.filter((e) => e.target === unlinked), `${block.name}: the second Halt is unlinked`).toEqual([])
      }
    } finally {
      await deleteTest(request, testId)
    }
  }
}

/** Lane controls fresh from the palette: first lane by a drop, the rest by Quick Insert, in drawing order. */
export async function wirePaletteDefaults(
  page: Page,
  request: APIRequestContext,
  blocks: readonly PaletteBlock[],
): Promise<void> {
  const pitch = { x: 380, y: 330 }
  const rows = Math.ceil(blocks.length / GRID_COLUMNS)
  const testId = await seedGrid(request, 'palette defaults', rows, pitch)
  try {
    await openLaneCanvas(page, testId)
    const placed: Array<{ block: PaletteBlock; id: string; targets: string[] }> = []
    for (const [i, block] of blocks.entries()) {
      const cell = { x: 150 + (i % GRID_COLUMNS) * pitch.x, y: 40 + Math.floor(i / GRID_COLUMNS) * pitch.y }
      const id = await placeFromPalette(page, block, cell)
      const drawn = await nodeLocator(page, id)
        .locator('[data-testid^="handle-output"]')
        .evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace(/^handle-output-?/, '')))
      expect.soft(drawn, `${block.name} draws its default lanes`).toEqual(block.lanes.map((lane) => lane ?? ''))
      const targets: string[] = []
      for (const [n, lane] of block.lanes.entries()) {
        const target = n === 0 ? await dropBelow(page, id, lane, 'halt') : await quickAddAfter(page, id, QUICK_HALT)
        targets.push(target)
        await expectDrawnFromLane(page, id, lane, target)
      }
      if (block.lanes.length === 0) {
        await dropBelowBlock(page, id, 'halt')
        await quickAddAfter(page, id, QUICK_HALT)
        await expect.soft(edgesFrom(page, id), `${block.name}: nothing links from a block with no exit`).toHaveCount(0)
      }
      await expect.soft(edgesFrom(page, id), `${block.name}: one link per lane`).toHaveCount(block.lanes.length)
      if (block.disable) await disableBlock(page, id)
      placed.push({ block, id, targets })
    }
    await saveCanvas(page)
    const saved = await savedEdges(request, testId)
    for (const { block, id, targets } of placed) {
      block.lanes.forEach((lane, n) => expectSavedLane(saved, id, lane, targets[n]))
      expect.soft(saved.filter((e) => e.source === id), `${block.name}: one saved link per lane`).toHaveLength(block.lanes.length)
    }
  } finally {
    await deleteTest(request, testId)
  }
}

// ---------------------------------------------------------------------------
// Building a flow block by block (drops that link as they land)
// ---------------------------------------------------------------------------

/** Expand the palette, fit the canvas to its blocks and wait for the viewport to settle. */
export async function fitCanvas(page: Page): Promise<void> {
  await expandPalette(page)
  await page.locator('.react-flow__controls-fitview').click()
  await waitForViewportSettled(page)
}

/** Drop a palette block just under Start; the drop links it from Start. */
export async function dropUnderStart(page: Page, block: PaletteDragSpec): Promise<string> {
  await fitCanvas(page)
  const canvas = await boxOf(page.getByTestId('workflow-canvas'), 'the canvas')
  const start = await boxOf(page.getByTestId(START), 'Start')
  const before = await canvasNodeIds(page)
  await dragPaletteItemToCanvas(page, block, {
    x: start.x - canvas.x + start.width / 2,
    y: start.y - canvas.y + start.height + 60,
  })
  const added = await onlyNewNode(page, before)
  await expect(edgeOnCanvas(page, START, added), 'the drop under Start links it').toHaveCount(1)
  return added
}

/** Drop a palette block under a lane dot; the drop links it from that lane. */
export async function dropUnderLane(
  page: Page,
  source: string,
  handle: string | null,
  block: PaletteDragSpec,
): Promise<string> {
  await fitCanvas(page)
  const id = await dropBelow(page, source, handle, block)
  await expect(edgeOnCanvas(page, source, id), `the drop links ${source} -> ${id}`).toHaveCount(1)
  await expectDrawnFromLane(page, source, handle, id)
  return id
}
