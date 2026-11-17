/**
 * V-WATCH-MCP-CANVAS-FUNCTIONAL: what a person did on the canvas holds through an assistant's
 * change of the test over the real MCP endpoint.
 * Design Decisions: WATCH-9, RUNM-6
 * REQ: REQ-5.2.7.18
 *
 * Pass Criteria:
 *  1. A test a person built on the canvas (an HTTP Request and three Logs dropped from the
 *     palette, each set in its Block window, saved from the New Test window; the canvas saves the
 *     HTTP Request without choices a compile writes) and changed by a watched change made from its
 *     own readback with one message changed: only that Block takes a turn under the assistant's
 *     banner (the steady border and the ring land on it alone); the answer and the stored test
 *     show the change on the same four Blocks; the tab holds the saved test again, clean.
 *  2. A fast amend keeps each recognized Block's "always mask" choice and its open description,
 *     also on the Block whose message it changes.
 *  3. A watched change keeps them the same way, every frame it plays shows both descriptions open,
 *     and only the Block whose message changed takes a turn.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/watch-mode/v-watch-mcp-canvas-functional.spec.ts
 */

import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { cleanUp, storedTest, testIdsNamed } from '../../helpers/fn-block'
import { callTool, callToolAsync, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { SEL, ownershipState, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import { setStringParam } from '../../helpers/param-config'
import { openBlockSheet, saveBlockSheet } from '../../helpers/workbench'
import { dropUnder, dropUnderStart } from '../null-checks/check-chain'
import {
  importFixture,
  loadFixture,
  openHolder,
  openWatcher,
  recordView,
  saveAsNewTest,
  trackDirtyReport,
  uniqueName,
  viewSamples,
  type ViewSample,
} from './helpers'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765
const WATCHED_CHANGE = 'amend_test_live_from_recipe'
const FAST_AMEND = 'amend_test_from_recipe'
const SAVE_BUTTON = '[data-testid="toolbar-save-button"]'
const CANVAS_URL = 'http://canvas-built.invalid/health'
const CANVAS_MESSAGES = ['canvas-alpha', 'canvas-bravo', 'canvas-charlie']
const CHANGED_MESSAGE = 'canvas-bravo-changed'
const ALPHA_DESCRIPTION = 'Alpha keeps its open description and masks every secret'
const BRAVO_DESCRIPTION = 'Bravo changes its message and keeps what the canvas set'

interface StoredBlock {
  id: string
  data: {
    label: string
    elementType?: string
    description?: string
    descriptionExpanded?: boolean
    config: { values: Record<string, unknown>; secret_masking?: string; unmasked_secret_fields?: string[] }
  }
}

interface StoredWorkflowTest {
  name: string
  version: string
  workflow: { nodes: StoredBlock[]; edges: { source: string; target: string }[] }
}

const open: BrowserContext[] = []
const track = (context: BrowserContext): void => {
  open.push(context)
}
const created: string[] = []

async function stored(request: APIRequestContext, testId: string): Promise<StoredWorkflowTest> {
  return (await storedTest(request, testId)) as unknown as StoredWorkflowTest
}

function blocksOf(saved: StoredWorkflowTest): string[] {
  return saved.workflow.nodes.map((node) => node.id).sort()
}

function urlOf(saved: StoredWorkflowTest, id: string): unknown {
  return saved.workflow.nodes.find((node) => node.id === id)?.data.config.values.url
}

/** Each Log's message, by its id. */
function messagesOf(saved: StoredWorkflowTest): Record<string, unknown> {
  return Object.fromEntries(
    saved.workflow.nodes
      .filter((node) => node.data.elementType === 'log')
      .map((node) => [node.id, node.data.config.values.message]),
  )
}

/** Drop an HTTP Request under Start from the palette and type its URL in its Block window; returns its id. */
async function buildHttpOnCanvas(page: Page): Promise<string> {
  const id = await dropUnderStart(page, 'http')
  const sheet = await openBlockSheet(page, id)
  await setStringParam(sheet, page, 'url', CANVAS_URL)
  await saveBlockSheet(sheet)
  return id
}

/** Drop a chain of Logs under a Block from the palette and type each message in its Block window; returns their ids. */
async function buildLogsOnCanvas(page: Page, after: string, messages: readonly string[]): Promise<string[]> {
  const ids: string[] = []
  for (const message of messages) {
    const id = await dropUnder(page, ids.at(-1) ?? after, null, 'log')
    const sheet = await openBlockSheet(page, id)
    await setStringParam(sheet, page, 'message', message)
    await saveBlockSheet(sheet)
    ids.push(id)
  }
  return ids
}

/** The readback with one Log's message changed; the message must appear in it exactly once. */
function withMessageChanged(readback: string, from: string, to: string): string {
  const line = new RegExp(`^(\\s+message: )(['"]?)${from}\\2$`, 'gm')
  expect(readback.match(line), `the readback holds "${from}" once: ${readback}`).toHaveLength(1)
  return readback.replace(line, `$1$2${to}$2`)
}

/** The samples from the first one under the assistant's banner on, and the ring the tab showed just before it. */
function playedSamples(samples: ViewSample[]): { played: ViewSample[]; carried: string | null } {
  const claimed = samples.findIndex((sample) => sample.watchingMcp)
  expect(claimed, `the assistant's banner shows after recording began: ${JSON.stringify(samples)}`).toBeGreaterThan(0)
  return { played: samples.slice(claimed), carried: samples[claimed - 1].ring }
}

/** The Blocks that took a turn (the steady border) and the Blocks that rang, each once, in order. */
function turnsAndRings(samples: ViewSample[]): { turns: string[]; rings: string[] } {
  const { played, carried } = playedSamples(samples)
  const turns = [...new Set(played.map((sample) => sample.active))].filter((id): id is string => id !== null)
  const rings = [...new Set(played.map((sample) => sample.ring))]
    .filter((ring): ring is string => ring !== null && ring !== carried)
    .map((ring) => ring.split('#')[0])
  return { turns, rings }
}

/** Keep Alpha as it is and change Bravo's message; neither the recipe nor the readback says the canvas settings. */
function settingsChangeRecipe(name: string): string {
  return [
    'test:',
    `  name: ${JSON.stringify(name)}`,
    '  description: Canvas settings kept',
    'flow:',
    '  - block: log',
    '    label: Alpha',
    `    description: ${ALPHA_DESCRIPTION}`,
    '    settings: {message: alpha}',
    '  - block: log',
    '    label: Bravo',
    '    key: bravo',
    `    description: ${BRAVO_DESCRIPTION}`,
    '    settings: {message: bravo-changed}',
    '',
  ].join('\n')
}

/** Both Blocks keep their open description and their "always mask" choice; Bravo has its new message. */
async function expectCanvasSettingsKept(request: APIRequestContext, testId: string): Promise<void> {
  const saved = await stored(request, testId)
  expect(
    saved.workflow.nodes
      .map((node) => ({
        id: node.id,
        message: node.data.config.values.message,
        description: node.data.description,
        descriptionExpanded: node.data.descriptionExpanded,
        secretMasking: node.data.config.secret_masking,
        unmaskedSecretFields: node.data.config.unmasked_secret_fields,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    'each recognized Block keeps what the canvas set',
  ).toEqual([
    {
      id: 'node-1',
      message: 'alpha',
      description: ALPHA_DESCRIPTION,
      descriptionExpanded: true,
      secretMasking: 'mask',
      unmaskedSecretFields: [],
    },
    {
      id: 'node-2',
      message: 'bravo-changed',
      description: BRAVO_DESCRIPTION,
      descriptionExpanded: true,
      secretMasking: 'mask',
      unmaskedSecretFields: [],
    },
  ])
}

async function seedSettingsTest(request: APIRequestContext): Promise<{ testId: string; name: string }> {
  const testId = await importFixture(request, loadFixture('fixture-canvas-settings.json'))
  created.push(testId)
  return { testId, name: (await stored(request, testId)).name }
}

test.describe('V-WATCH-MCP-CANVAS-FUNCTIONAL: what the canvas set holds through an assistant change', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
    await cleanUp(request, created)
    await resetMcpSettings(page)
  })

  test('a test built on the canvas: a watched change gives a turn only to the Block it changes', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    let reportedDirty = (): boolean => false
    const tab = await openWatcher(browser, track, (opened) => {
      reportedDirty = trackDirtyReport(opened)
    })
    const holding = await waitUntilHeld(request)
    expect(holding.kind, 'the tab holds the free session').toBe('person')

    const name = uniqueName('Watch Canvas Built')
    const { http, ids } = await test.step('a person builds the test on the canvas and saves it', async () => {
      const first = await buildHttpOnCanvas(tab)
      const dropped = await buildLogsOnCanvas(tab, first, CANVAS_MESSAGES)
      await expect.poll(() => reportedDirty(), { message: 'the tab tells the server it has unsaved work' }).toBe(true)
      await saveAsNewTest(tab, name)
      await expect.poll(() => reportedDirty(), { message: 'the tab tells the server its work is saved' }).toBe(false)
      return { http: first, ids: dropped }
    })
    const found = await testIdsNamed(request, name)
    created.push(...found)
    expect(found, 'the New Test window saved one test').toHaveLength(1)
    const testId = found[0]
    const before = await stored(request, testId)
    expect(blocksOf(before), 'the canvas saved the four Blocks').toEqual([http, ...ids].sort())
    expect(urlOf(before, http), 'the canvas saved the typed URL').toBe(CANVAS_URL)
    expect(messagesOf(before), 'the canvas saved the three typed messages').toEqual(
      Object.fromEntries(ids.map((id, index) => [id, CANVAS_MESSAGES[index]])),
    )

    const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
    expect(readback.payload.expressible, JSON.stringify(readback.payload)).toBe(true)
    const recipe = withMessageChanged(String(readback.payload.recipe), CANVAS_MESSAGES[1], CHANGED_MESSAGE)

    await recordView(tab)
    await expect.poll(async () => (await viewSamples(tab)).length).toBeGreaterThan(0)
    const result = await callToolAsync(MCP_PORT, WATCHED_CHANGE, { test_ref: testId, recipe })
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload, JSON.stringify(result.payload)).toMatchObject({ amended: true, test_id: testId, name })

    await test.step('the stored test is the change, on the same four Blocks', async () => {
      const after = await stored(request, testId)
      expect(after.version).toBe(result.payload.version)
      expect(after.version).not.toBe(before.version)
      expect(blocksOf(after)).toEqual(blocksOf(before))
      expect(urlOf(after, http)).toBe(CANVAS_URL)
      expect(messagesOf(after)).toEqual({
        [ids[0]]: CANVAS_MESSAGES[0],
        [ids[1]]: CHANGED_MESSAGE,
        [ids[2]]: CANVAS_MESSAGES[2],
      })
    })

    await test.step('only the Block whose message changed takes a turn', async () => {
      await expect(tab.locator(SEL.banner)).toHaveCount(0, { timeout: 15_000 })
      const samples = await viewSamples(tab)
      expect(turnsAndRings(samples), `one turn and one ring, on the changed Block: ${JSON.stringify(samples)}`).toEqual({
        turns: [ids[1]],
        rings: [ids[1]],
      })
    })

    await test.step('the tab holds the saved test again, clean', async () => {
      await expect
        .poll(async () => (await ownershipState(request)).holder?.id, { timeout: 15_000 })
        .toBe(holding.id)
      await expect(tab.locator(SEL.canvasReadOnly)).toHaveCount(0)
      await expect(tab.locator(SAVE_BUTTON)).toBeDisabled()
      await expect(tab.getByRole('alertdialog')).toHaveCount(0)
    })
  })

  test('a fast amend keeps each Block\'s "always mask" choice and its open description', async ({ page, request }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const { testId, name } = await seedSettingsTest(request)

    const result = callTool(MCP_PORT, FAST_AMEND, { test_ref: testId, recipe: settingsChangeRecipe(name) })
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload, JSON.stringify(result.payload)).toMatchObject({ amended: true, test_id: testId })
    await expectCanvasSettingsKept(request, testId)
  })

  test('a watched change keeps them too, and every frame it plays shows both descriptions open', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const { testId, name } = await seedSettingsTest(request)
    const tab = await openHolder(browser, testId, track)
    const holding = await waitUntilHeld(request)
    expect(holding.kind).toBe('person')
    await recordView(tab)
    await expect.poll(async () => (await viewSamples(tab)).length).toBeGreaterThan(0)
    expect((await viewSamples(tab))[0].expanded, 'the tab opens both descriptions').toEqual(['node-1', 'node-2'])

    const result = await callToolAsync(MCP_PORT, WATCHED_CHANGE, { test_ref: testId, recipe: settingsChangeRecipe(name) })
    expect(result.isError, JSON.stringify(result.payload)).toBe(false)
    expect(result.payload, JSON.stringify(result.payload)).toMatchObject({ amended: true, test_id: testId })
    await expectCanvasSettingsKept(request, testId)

    await test.step('every frame shows both descriptions open, and only Bravo takes a turn', async () => {
      await expect
        .poll(async () => (await ownershipState(request)).holder?.id, { timeout: 15_000 })
        .toBe(holding.id)
      await expect(tab.locator(SEL.banner)).toHaveCount(0)
      const samples = await viewSamples(tab)
      const detail = JSON.stringify(samples)
      const { played } = playedSamples(samples)
      for (const sample of played) {
        expect(sample.expanded, `each frame keeps both descriptions open: ${detail}`).toEqual(['node-1', 'node-2'])
      }
      expect(turnsAndRings(samples), `only Bravo, whose message changed, takes a turn: ${detail}`).toEqual({
        turns: ['node-2'],
        rings: ['node-2'],
      })
    })
  })
})
