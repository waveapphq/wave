/**
 * V-PRERUN-DIRTY-GATE (functional): the pre-run check validates what is about
 * to run, not the last saved copy of the Test.
 *
 * A Block enabled and configured on the canvas but not yet saved is what the
 * engine executes, so it is what the gate must check. The contract this spec
 * pins, on NON-K8s Blocks (a plugin and a control) and on every entry point
 * that reaches the shared gate:
 *
 *   1. Run on a dirty canvas whose Block has a required parameter unset does
 *      not start, and the dialog names the Block and the parameter.
 *   2. Debug, the ad-hoc "Run Current", and Run Scope inside a Function are
 *      refused the same way.
 *   3. The same holes SAVED are still refused, by the backend half.
 *   4. A VALID dirty canvas still runs, with no false block, and the Block
 *      enabled on the canvas actually executes.
 *
 * Case 4 is the trap: a check that refused everything would look correct without it.
 *
 * Phase: functional-workflow.
 * REQ: REQ-3.1.2.4 (Block validation before save - the same validation surface
 * applied before a run).
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { ensureEnvironment } from '../../helpers/config'
import {
  createValidTest,
  delayNode,
  localFunctionNode,
  logNode,
  openTest,
  startEdge,
  validateTest,
  VALIDATION,
} from '../../helpers/fn-seed'
import { importExpectingErrors } from '../../helpers/fixture-import'
import { getLogTexts } from '../../helpers/log-reader'
import { clearPointerLock, digIn, selectEnvironment } from '../../helpers/workbench'

type SeedNode = Record<string, unknown>

interface SeedNodeData {
  disabled?: boolean
  config?: { values?: Record<string, unknown> }
}

const MESSAGE_HOLE = "Required parameter 'message' is empty"
const DURATION_HOLE = "Required parameter 'duration' is missing"
const ANNOUNCE_TEXT = 'prerun gate ready'
const SECOND_TEXT = 'second block ran'

const uniqueName = (label: string): string =>
  `V-PRERUN-DIRTY-GATE ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** The fn-seed Block builders carry no `disabled` flag (only sharedNode does). */
function seedDisabled(node: SeedNode): SeedNode {
  ;(node.data as SeedNodeData).disabled = true
  return node
}

/** Drop a required parameter so the Block carries the hole the gate must catch. */
function seedWithout(node: SeedNode, param: string): SeedNode {
  const values = (node.data as SeedNodeData).config?.values
  if (values) delete values[param]
  return node
}

const edge = (source: string, target: string): SeedNode => ({
  id: `e-${source}-${target}`,
  source,
  target,
})

const canvasNode = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="workflow-node-${id}"]`)
const runButton = (page: Page): Locator => page.locator('[data-testid="run-button"]')
const debugButton = (page: Page): Locator => page.locator('[data-testid="debug-button"]')
const statusBadge = (page: Page): Locator => page.locator('[data-testid="workflow-status"]')
const gate = (page: Page): Locator => page.locator(VALIDATION.dialog)

/** The unconfigured Log (plugin) and Delay (control) Blocks both Tests share. */
function holeBlocks(): SeedNode[] {
  return [
    logNode('hole-log', 'Unconfigured Log', '', { x: 420, y: 200 }),
    seedWithout(delayNode('hole-delay', 'Unset Delay', 1, { x: 640, y: 200 }), 'duration'),
  ]
}

const holeEdges = (): SeedNode[] => [
  startEdge('announce'),
  edge('announce', 'hole-log'),
  edge('hole-log', 'hole-delay'),
]

/** Announce plus the two holes, both DISABLED - so the SAVED copy is valid and
 *  anything the gate reports can only have come from the canvas. */
async function seedDisabledHoles(request: APIRequestContext, label: string): Promise<string> {
  return await createValidTest(request, {
    name: uniqueName(label),
    nodes: [
      logNode('announce', 'Announce', `'${ANNOUNCE_TEXT}'`),
      ...holeBlocks().map(seedDisabled),
    ],
    edges: holeEdges(),
  })
}

/** Enable a Block on the canvas and leave the Test unsaved. */
async function enableOnCanvas(page: Page, nodeId: string): Promise<void> {
  await clickNodeKebabItem(page, nodeId, 'Enable')
  await expect(canvasNode(page, nodeId)).not.toHaveAttribute('data-disabled', 'true')
  // A closed Radix menu can leave a pointer lock that swallows the next click.
  await clearPointerLock(page)
}

/** One gate row: the Block's name and its parameter message, read from the same row. */
async function expectGateRow(page: Page, blockLabel: string, message: string): Promise<void> {
  const row = gate(page)
    .locator(`${VALIDATION.list} tr`)
    .filter({ has: page.getByRole('button', { name: blockLabel, exact: true }) })
    .filter({ hasText: message })
  await expect(row.first(), `gate row for "${blockLabel}" carrying "${message}"`).toBeVisible()
}

async function expectGate(page: Page, title: string): Promise<void> {
  await expect(gate(page)).toBeVisible({ timeout: 10_000 })
  await expect(gate(page)).toContainText(title)
}

/** The refusal happens before the engine is asked for anything. */
async function expectRunNeverStarted(page: Page): Promise<void> {
  await expect(statusBadge(page), 'the run must not start').toHaveAttribute('data-status', 'idle')
}

async function closeGate(page: Page): Promise<void> {
  await page.locator(VALIDATION.closeBtn).click()
  await expect(gate(page)).toBeHidden({ timeout: 5_000 })
  await clearPointerLock(page)
}

/** Open a seeded Test with the environment picked, ready to press Run. */
async function openReadyToRun(page: Page, testId: string): Promise<void> {
  await ensureEnvironment(page.request)
  await openTest(page, testId)
  await selectEnvironment(page)
  await expectRunNeverStarted(page)
}

test.describe('V-PRERUN-DIRTY-GATE: the pre-run check reads the canvas, not the saved copy', () => {
  test('Run: Blocks enabled on the canvas and never saved are refused, each named with its parameter', async ({
    page,
    request,
  }) => {
    const testId = await seedDisabledHoles(request, 'run')

    // The saved copy is clean - both holes sit on disabled Blocks - so every
    // finding below can only have come from the canvas.
    const saved = await validateTest(request, testId, 'run')
    expect(saved.status, 'the saved copy must validate clean').toBe(200)
    expect(saved.errors).toEqual([])

    await openReadyToRun(page, testId)

    await enableOnCanvas(page, 'hole-log')
    await enableOnCanvas(page, 'hole-delay')

    await runButton(page).click()

    await expectGate(page, 'Cannot Run Test')
    await expectGateRow(page, 'Unconfigured Log', MESSAGE_HOLE)
    await expectGateRow(page, 'Unset Delay', DURATION_HOLE)
    await expectRunNeverStarted(page)

    await closeGate(page)
    await expectRunNeverStarted(page)
  })

  test('Debug: the same unsaved hole is refused, with the Debug wording', async ({
    page,
    request,
  }) => {
    const testId = await seedDisabledHoles(request, 'debug')
    await openReadyToRun(page, testId)

    await enableOnCanvas(page, 'hole-delay')

    await debugButton(page).click()

    await expectGate(page, 'Cannot Debug Test')
    await expectGateRow(page, 'Unset Delay', DURATION_HOLE)
    await expectRunNeverStarted(page)

    await closeGate(page)
  })

  test('Run Current: the ad-hoc run goes through the same gate', async ({ page, request }) => {
    const testId = await seedDisabledHoles(request, 'adhoc')
    await openReadyToRun(page, testId)

    await enableOnCanvas(page, 'hole-log')

    await clickNodeKebabItem(page, 'hole-log', 'Run Current')

    await expectGate(page, 'Cannot Run Test')
    await expectGateRow(page, 'Unconfigured Log', MESSAGE_HOLE)
    await expectRunNeverStarted(page)

    await closeGate(page)
  })

  test('Run Scope inside a Function goes through the same gate', async ({ page, request }) => {
    const testId = await createValidTest(request, {
      name: uniqueName('fn-scope'),
      nodes: [
        localFunctionNode('fn-local', 'Scoped Function', {
          nodes: [logNode('inner-log', 'Inner Log', "'inner ran'")],
          edges: [{ id: 'e-start-inner-log', source: 'start-node', target: 'inner-log' }],
        }),
        seedDisabled(logNode('hole-log', 'Unconfigured Log', '', { x: 620, y: 200 })),
      ],
      edges: [startEdge('fn-local'), edge('fn-local', 'hole-log')],
    })
    await openReadyToRun(page, testId)

    await enableOnCanvas(page, 'hole-log')

    // Drill into the Function, then run the scope from inside it.
    await digIn(page, 'fn-local')
    await expect(canvasNode(page, 'inner-log')).toBeVisible()

    await page.locator('[data-testid="run-button-dropdown"]').click()
    await page.locator('[data-testid="run-current-option"]').click()

    await expectGate(page, 'Cannot Run Test')
    await expectGateRow(page, 'Unconfigured Log', MESSAGE_HOLE)
    await expectRunNeverStarted(page)

    await closeGate(page)
  })

  test('the same holes SAVED are still refused before the run starts', async ({ page }) => {
    const imported = await importExpectingErrors(page, {
      name: uniqueName('saved'),
      workflow: {
        nodes: [logNode('announce', 'Announce', `'${ANNOUNCE_TEXT}'`), ...holeBlocks()],
        edges: holeEdges(),
      },
    })

    expect(imported.status, 'the stored copy must fail the run-context check').toBe(422)
    const messages = imported.errors.map((e) => String(e.message))
    expect(messages).toContain(MESSAGE_HOLE)
    expect(messages).toContain(DURATION_HOLE)

    await selectEnvironment(page)
    await expectRunNeverStarted(page)

    await runButton(page).click()

    await expectGate(page, 'Cannot Run Test')
    await expectGateRow(page, 'Unconfigured Log', MESSAGE_HOLE)
    await expectGateRow(page, 'Unset Delay', DURATION_HOLE)
    await expectRunNeverStarted(page)

    await closeGate(page)
  })

  test('a valid dirty canvas still runs, and the Block enabled on it executes', async ({
    page,
    request,
  }) => {
    // A check that refused everything would pass every case above and fail only here.
    const testId = await createValidTest(request, {
      name: uniqueName('valid-dirty'),
      nodes: [
        logNode('announce', 'Announce', `'${ANNOUNCE_TEXT}'`),
        seedDisabled(logNode('second', 'Second Log', `'${SECOND_TEXT}'`, { x: 420, y: 200 })),
      ],
      edges: [startEdge('announce'), edge('announce', 'second')],
    })
    await openReadyToRun(page, testId)

    await enableOnCanvas(page, 'second')

    await runButton(page).click()

    await expect(statusBadge(page)).toHaveAttribute('data-status', /passed|success/, {
      timeout: 60_000,
    })
    await expect(gate(page), 'a valid dirty canvas must not be blocked').toBeHidden()

    const texts = await getLogTexts(page)
    expect(texts.some((t) => t.includes(ANNOUNCE_TEXT)), JSON.stringify(texts)).toBeTruthy()
    expect(
      texts.some((t) => t.includes(SECOND_TEXT)),
      `the Block enabled on the canvas must have run: ${JSON.stringify(texts)}`,
    ).toBeTruthy()
  })
})
