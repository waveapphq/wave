/**
 * V-PLUGIN-SSH-BOUNDS-FUNCTIONAL: SSH numeric bounds on the field and when the block runs
 * Design Decisions: SSH-9, PING-17, FIELDERR-1
 * REQ: REQ-5.1.5, REQ-3.4.1.3
 *
 * Built through the UI: an empty Test, SSH Session Open / Exec / Script and SSH Tunnel Open dropped
 * from the palette and edited in their sheets. `fixture-bounds-stored.json` stores Connect Timeout 0
 * on one Session Open; `fixture-bounds.json` holds the out-of-range values as expressions, each block
 * in its own Try/Catch. No server is written and no session connects.
 *
 * Pass Criteria:
 * 1. BND-1: each literal outside its bound shows its message under the field as it is typed, the
 *    input is marked invalid, Save is disabled under the settings-errors note, the typed value is
 *    kept verbatim and no other row is flagged: Port 0 and 65536 ("Port must be between 1 and
 *    65535"), Connect Timeout 0 ("Connect Timeout must be at least 1"), Keep-Alive Interval -1
 *    ("Keep-Alive Interval must be at least 0"), Keep-Alive Max Count 0 ("Keep-Alive Max Count must
 *    be at least 1"), Session Exec and Session Script Timeout 0 ("Timeout must be at least 1"),
 *    Local Port -1 and 65536 ("Local Port must be between 0 and 65535"), Remote Port 0 and 65536
 *    ("Remote Port must be between 1 and 65535").
 * 2. BND-2: the edges are accepted with no message: Port 1 and 65535, Keep-Alive Interval 0, Local
 *    Port 0 and 65535, Remote Port 1 and 65535; the sheets save and the Test reads back with the
 *    values as typed.
 * 3. BND-3: POST /tests refuses a Connect Timeout 0 with SETTING_BELOW_MINIMUM "Setting
 *    'connect_timeout' of block 'ssh-session-open' must be at least 1, got 0"; stored past the
 *    save (admin import), it paints the canvas alert badge with exactly "Connect Timeout
 *    must be at least 1" in its tooltip; Save stays shut (the sheet's and the unsaved-changes
 *    question's) and nothing reaches the stored Test until the value is back inside the bound;
 *    then the sheet saves, the badge clears and the Test reads back with the fixed value.
 * 4. BND-4: with the values as expressions the canvas flags nothing, the run passes, and each
 *    Try/Catch catches its backend text exactly: "Parameter 'port' must be between 1 and 65535"
 *    (Port 70000), "Connect timeout must be at least 1" (0), "Keep-alive interval must be 0 or
 *    more" (-1), "Keep-alive max count must be at least 1" (0), "Timeout must be at least 1"
 *    (Session Exec 0 and Session Script 0), "Parameter 'local_port' must be between 0 and 65535"
 *    (70000), "Parameter 'remote_port' must be between 1 and 65535" (0); no block connects.
 */

import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette, waitForViewportSettled } from '../../helpers/canvas'
import { numberInput, rowAlerts, rowError, saveButton, settingsNote } from '../../helpers/config-sheet'
import { setStringParam } from '../../helpers/param-config'
import {
  BACKEND_URL,
  SSH_MAIN_PORT,
  SSH_MAIN_SERVICE,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
  SSH_TARGET_HOST,
} from '../../helpers/config'
import { createValidTest, openTest, validateTest } from '../../helpers/fn-seed'
import {
  getActiveSessionId,
  getSessionVariables,
  importExpectingErrors,
  importValidateAndNavigate,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries, getLogEntries } from '../../helpers/log-reader'
import { clearPointerLock } from '../../helpers/workbench'
import {
  deleteTest,
  expandGroup,
  openConfig,
  persistedValues,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'

// ---------------------------------------------------------------------------
// Exact texts: the field messages and the run refusals (SSH-9)
// ---------------------------------------------------------------------------

const FORM = {
  port: 'Port must be between 1 and 65535',
  connectTimeout: 'Connect Timeout must be at least 1',
  keepAliveInterval: 'Keep-Alive Interval must be at least 0',
  keepAliveMaxCount: 'Keep-Alive Max Count must be at least 1',
  timeout: 'Timeout must be at least 1',
  localPort: 'Local Port must be between 0 and 65535',
  remotePort: 'Remote Port must be between 1 and 65535',
}

const RUN = {
  port: "Parameter 'port' must be between 1 and 65535",
  connectTimeout: 'Connect timeout must be at least 1',
  keepAliveInterval: 'Keep-alive interval must be 0 or more',
  keepAliveMaxCount: 'Keep-alive max count must be at least 1',
  timeout: 'Timeout must be at least 1',
  localPort: "Parameter 'local_port' must be between 0 and 65535",
  remotePort: "Parameter 'remote_port' must be between 1 and 65535",
}

const SETTINGS_NOTE = 'Save is disabled: the settings have errors'
const SAVE_BELOW_MINIMUM = "Setting 'connect_timeout' of block 'ssh-session-open' must be at least 1, got 0"
const SESSION_ID = 'ssh_session_bounds'
const NEVER_RUNS = 'echo never-runs'
const BOOKEND = 'ssh-bounds-done'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Json = Record<string, any>

/** Load a fixture beside the spec with its placeholders filled for this run. */
function loadFixture(file: string, runId: string): Json {
  const whole: Record<string, unknown> = {
    __SSH_PORT__: Number(SSH_MAIN_PORT),
    __SSH_USER__: SSH_STACK_USER,
    __SSH_PASSWORD__: SSH_STACK_PASSWORD,
    __FAR_HOST__: SSH_MAIN_SERVICE,
  }
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]))
    }
    if (typeof node !== 'string') return node
    return Object.hasOwn(whole, node) ? whole[node] : node.replaceAll('__RUN_UUID__', runId)
  }
  return walk(JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))) as Json
}

function nodeByDescription(fixture: Json, description: string): Json {
  const node = (fixture.workflow.nodes as Json[]).find((entry) => entry.data.description === description)
  expect(node, `the fixture holds a block described "${description}"`).toBeTruthy()
  return node as Json
}

// ---------------------------------------------------------------------------
// BND-1 / BND-2: the four blocks as built in their sheets
// ---------------------------------------------------------------------------

interface Bound {
  row: string
  message: string
  outside: string[]
  inside: string[]
}

interface SheetBlock {
  label: string
  paletteId: string
  advanced: boolean
  text: Array<[string, string]>
  numbers: Array<[string, string]>
  bounds: Bound[]
}

const SHEET_BLOCKS: SheetBlock[] = [
  {
    label: 'SSH Session Open',
    paletteId: 'palette-item-ssh-session-open',
    advanced: true,
    text: [
      ['host', SSH_TARGET_HOST],
      ['username', SSH_STACK_USER],
    ],
    numbers: [],
    bounds: [
      { row: 'port', message: FORM.port, outside: ['0', '65536'], inside: ['1', '65535'] },
      { row: 'connect_timeout', message: FORM.connectTimeout, outside: ['0'], inside: ['1'] },
      { row: 'keep_alive_interval', message: FORM.keepAliveInterval, outside: ['-1'], inside: ['0'] },
      { row: 'keep_alive_max_count', message: FORM.keepAliveMaxCount, outside: ['0'], inside: ['1'] },
    ],
  },
  {
    label: 'SSH Session Exec',
    paletteId: 'palette-item-ssh-session-exec',
    advanced: false,
    text: [
      ['session_id', SESSION_ID],
      ['command', NEVER_RUNS],
    ],
    numbers: [],
    bounds: [{ row: 'timeout', message: FORM.timeout, outside: ['0'], inside: ['1'] }],
  },
  {
    label: 'SSH Session Script',
    paletteId: 'palette-item-ssh-session-script',
    advanced: false,
    text: [
      ['session_id', SESSION_ID],
      ['script', NEVER_RUNS],
    ],
    numbers: [],
    bounds: [{ row: 'timeout', message: FORM.timeout, outside: ['0'], inside: ['1'] }],
  },
  {
    label: 'SSH Tunnel Open',
    paletteId: 'palette-item-ssh-tunnel-open',
    advanced: false,
    text: [
      ['session_id', SESSION_ID],
      ['remote_host', SSH_MAIN_SERVICE],
    ],
    numbers: [['remote_port', '22']],
    bounds: [
      { row: 'local_port', message: FORM.localPort, outside: ['-1', '65536'], inside: ['0', '65535'] },
      { row: 'remote_port', message: FORM.remotePort, outside: ['0', '65536'], inside: ['1', '65535'] },
    ],
  },
]

/** What the saved Test must hold for a block: its text rows and the last in-bound value typed per row. */
function expectedValues(block: SheetBlock): Record<string, unknown> {
  return {
    ...Object.fromEntries(block.text),
    ...Object.fromEntries(block.bounds.map((bound) => [bound.row, Number(bound.inside.at(-1))])),
  }
}

async function viewportScale(page: Page): Promise<number> {
  const transform = await page
    .locator('.react-flow__viewport')
    .first()
    .evaluate((viewport) => getComputedStyle(viewport).transform)
  const match = /^matrix\(([^,]+),/.exec(transform)
  return match ? Number(match[1]) : 1
}

/** An empty Test opens at the maximum zoom, where four blocks cannot sit side by side. */
async function zoomOutTo(page: Page, target: number): Promise<void> {
  const zoomOut = page.locator('button.react-flow__controls-zoomout')
  for (let click = 0; click < 12 && (await viewportScale(page)) > target; click++) {
    await zoomOut.click()
    await waitForViewportSettled(page)
  }
  expect(await viewportScale(page), 'the canvas zoomed out').toBeLessThanOrEqual(target)
}

async function workflowNodeIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.getAttribute('data-testid') ?? '').replace('workflow-node-', '')),
    )
}

/** Drop one palette block onto the canvas and return the id of the block the drop made. */
async function dropBlock(page: Page, block: SheetBlock, position: { x: number; y: number }): Promise<string> {
  const before = new Set(await workflowNodeIds(page))
  await dragPaletteItemToCanvas(page, { term: block.label, testId: block.paletteId }, position)
  const added = (await workflowNodeIds(page)).filter((id) => !before.has(id))
  expect(added, `one ${block.label} block was dropped`).toHaveLength(1)
  return added[0]
}

/** Type a number into a row's box key by key: the first key replaces a gray default (FIELD-2). */
async function typeNumber(box: Locator, literal: string): Promise<void> {
  await box.click()
  await box.press('ControlOrMeta+a')
  await box.pressSequentially(literal)
}

/** PING-17: a literal outside the bound is flagged as typed, on its own row only, and kept. */
async function expectFlagged(sheet: Locator, row: string, literal: string, message: string): Promise<void> {
  const input = numberInput(sheet, row)
  await typeNumber(input, literal)
  await expect(input, 'the typed value is kept verbatim, never clamped').toHaveValue(literal)
  await expect(rowError(sheet, row), `${row} ${literal}`).toHaveText(message)
  await expect(input, `${row} ${literal} is marked invalid`).toHaveAttribute('aria-invalid', 'true')
  await expect(rowAlerts(sheet), `${row} ${literal}: no other row is flagged`).toHaveCount(1)
  await expect(settingsNote(sheet), `${row} ${literal}`).toHaveText(SETTINGS_NOTE)
  await expect(saveButton(sheet), `${row} ${literal} keeps Save shut`).toBeDisabled()
}

async function expectAccepted(sheet: Locator, row: string, literal: string): Promise<void> {
  const input = numberInput(sheet, row)
  await typeNumber(input, literal)
  await expect(input).toHaveValue(literal)
  await expect(rowError(sheet, row), `${row} ${literal} is inside the bound`).toHaveCount(0)
  await expect(input, `${row} ${literal}`).not.toHaveAttribute('aria-invalid', 'true')
  await expect(rowAlerts(sheet), `${row} ${literal}`).toHaveCount(0)
  await expect(settingsNote(sheet), `${row} ${literal}`).toHaveCount(0)
  await expect(saveButton(sheet), `${row} ${literal}`).toBeEnabled()
}

// ---------------------------------------------------------------------------
// BND-4: one leg per Try/Catch in fixture-bounds.json
// ---------------------------------------------------------------------------

interface RunLeg {
  key: string
  description: string
  elementType: string
  message: string
}

const RUN_LEGS: RunLeg[] = [
  { key: 'port', description: 'Port 70000', elementType: 'ssh-session-open', message: RUN.port },
  {
    key: 'connect_timeout',
    description: 'Connect Timeout 0',
    elementType: 'ssh-session-open',
    message: RUN.connectTimeout,
  },
  {
    key: 'keep_alive_interval',
    description: 'Keep-Alive Interval -1',
    elementType: 'ssh-session-open',
    message: RUN.keepAliveInterval,
  },
  {
    key: 'keep_alive_max_count',
    description: 'Keep-Alive Max Count 0',
    elementType: 'ssh-session-open',
    message: RUN.keepAliveMaxCount,
  },
  {
    key: 'exec_timeout',
    description: 'Session Exec Timeout 0',
    elementType: 'ssh-session-exec',
    message: RUN.timeout,
  },
  {
    key: 'script_timeout',
    description: 'Session Script Timeout 0',
    elementType: 'ssh-session-script',
    message: RUN.timeout,
  },
  { key: 'local_port', description: 'Local Port 70000', elementType: 'ssh-tunnel-open', message: RUN.localPort },
  { key: 'remote_port', description: 'Remote Port 0', elementType: 'ssh-tunnel-open', message: RUN.remotePort },
]

const CAUGHT_PREFIX = 'Try-path error caught: '

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const created: string[] = []

test.describe('V-PLUGIN-SSH-BOUNDS-FUNCTIONAL: SSH numeric bounds', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test('BND-1 / BND-2: literals outside the bound are flagged in the sheet; the edges are accepted and saved', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    const testId = await createValidTest(request, {
      name: `V-PLUGIN-SSH-BOUNDS-FUNCTIONAL sheets ${randomUUID()}`,
      nodes: [],
      edges: [],
    })
    created.push(testId)
    await openTest(page, testId)

    const ids = new Map<SheetBlock, string>()
    await test.step('the four SSH blocks are dropped from the palette', async () => {
      // The palette shares the row with the canvas: open it before measuring.
      await expandPalette(page)
      await zoomOutTo(page, 0.75)
      const canvasBox = await page.getByTestId('workflow-canvas').boundingBox()
      expect(canvasBox, 'the canvas is laid out').toBeTruthy()
      for (const [index, block] of SHEET_BLOCKS.entries()) {
        const position = {
          x: canvasBox!.width * (index % 2 === 0 ? 0.25 : 0.7),
          y: canvasBox!.height * (index < 2 ? 0.62 : 0.82),
        }
        ids.set(block, await dropBlock(page, block, position))
      }
      const boxes = await Promise.all(
        [...ids.values()].map((id) => page.getByTestId(`workflow-node-${id}`).boundingBox()),
      )
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const apart = a!.x + a!.width <= b!.x || b!.x + b!.width <= a!.x || a!.y + a!.height <= b!.y || b!.y + b!.height <= a!.y
          expect(apart, 'no two dropped blocks overlap').toBe(true)
        }
      }
    })

    for (const block of SHEET_BLOCKS) {
      await test.step(`${block.label}: each bound flagged on its own row, each edge accepted`, async () => {
        const sheet = await openConfig(page, ids.get(block)!)
        await expect(sheet.getByRole('heading', { name: `${block.label} - Edit Config` })).toBeVisible()
        if (block.advanced) await expandGroup(sheet, 'Advanced')
        for (const [row, text] of block.text) await setStringParam(sheet, page, row, text)
        for (const [row, literal] of block.numbers) await typeNumber(numberInput(sheet, row), literal)
        await expect(rowAlerts(sheet), 'every required row holds a value, so nothing is flagged').toHaveCount(0)
        await expect(saveButton(sheet)).toBeEnabled()

        for (const bound of block.bounds) {
          for (const literal of bound.outside) await expectFlagged(sheet, bound.row, literal, bound.message)
          for (const literal of bound.inside) await expectAccepted(sheet, bound.row, literal)
        }
        await saveConfig(sheet)
      })
    }

    await test.step('the saved Test holds every value as typed', async () => {
      await saveWorkbench(page)
      const stored = await persistedValues(request, testId)
      for (const block of SHEET_BLOCKS) {
        const values = stored[ids.get(block)!]
        expect(values, `${block.label} is stored`).toBeTruthy()
        expect(values, block.label).toMatchObject(expectedValues(block))
      }
    })
  })

  test('BND-3: a stored Connect Timeout 0 paints the canvas badge and keeps Save shut until fixed', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const fixture = loadFixture('fixture-bounds-stored.json', randomUUID())
    const nodeId = nodeByDescription(fixture, 'Connect Timeout 0').id as string

    await test.step('the save refuses the value outside the bound, so the Test is seeded past it', async () => {
      const refused = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
      expect(refused.status(), 'POST /tests refuses a Connect Timeout below its minimum').toBe(422)
      const details = ((await refused.json()).error.details ?? []) as Array<Record<string, string>>
      expect(details.map((d) => [d.code, d.node_id, d.message])).toEqual([
        ['SETTING_BELOW_MINIMUM', nodeId, SAVE_BELOW_MINIMUM],
      ])
    })
    const imported = await importExpectingErrors(page, fixture, { injectSsh: true, context: 'load' })
    const testId = imported.testId
    created.push(testId)
    expect(imported.errors.map((e) => [e.code, e.message])).toEqual([['SETTING_BELOW_MINIMUM', SAVE_BELOW_MINIMUM]])
    const badge = page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-validation-alert"]`)

    await test.step('the canvas alert badge names the bound in its tooltip', async () => {
      await expect(badge, 'the block carries the canvas alert badge').toBeVisible({ timeout: 10_000 })
      await badge.hover()
      const tooltip = page.locator('[role="tooltip"]').last()
      await expect(tooltip).toBeVisible({ timeout: 5_000 })
      await expect(tooltip.locator('li')).toHaveText([FORM.connectTimeout])
      await page.mouse.move(0, 0)
    })

    const sheet = await openConfig(page, nodeId)
    const timeout = numberInput(sheet, 'connect_timeout')
    await test.step('the sheet flags the stored value on its own row and keeps it', async () => {
      await expandGroup(sheet, 'Advanced')
      await expect(rowError(sheet, 'connect_timeout')).toHaveText(FORM.connectTimeout)
      await expect(timeout, 'the stored value is kept verbatim').toHaveValue('0')
      await expect(timeout).toHaveAttribute('aria-invalid', 'true')
      await expect(rowAlerts(sheet), 'no other row is flagged').toHaveCount(1)
      await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
      await expect(saveButton(sheet)).toBeDisabled()
    })

    await test.step('another edit does not open Save, the unsaved-changes question cannot save either, and nothing is stored', async () => {
      await typeNumber(numberInput(sheet, 'keep_alive_max_count'), '5')
      await expect(rowAlerts(sheet)).toHaveCount(1)
      await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
      await expect(saveButton(sheet), 'the bound alone holds Save shut').toBeDisabled()

      await sheet.getByRole('button', { name: /^Cancel$/ }).last().click()
      const question = page.getByTestId('unsaved-changes-dialog')
      await expect(question).toBeVisible()
      await expect(question.getByTestId('save-blocked-note')).toHaveText(SETTINGS_NOTE)
      await expect(question.getByTestId('unsaved-save')).toBeDisabled()
      await question.getByTestId('unsaved-keep-editing').click()
      await expect(question).toBeHidden()
      await clearPointerLock(page)
      await expect(sheet).toBeVisible()
      await expect(timeout).toHaveValue('0')
      await expect(numberInput(sheet, 'keep_alive_max_count')).toHaveValue('5')

      const stored = (await persistedValues(request, testId))[nodeId]
      expect(stored.connect_timeout, 'the stored Test still holds the out-of-range value').toBe(0)
      expect(stored.keep_alive_max_count, 'the blocked edit never reached the stored Test').toBeUndefined()
    })

    await test.step('back inside the bound, the sheet saves, the badge clears and the Test reads back fixed', async () => {
      await typeNumber(timeout, '30')
      await expect(rowAlerts(sheet)).toHaveCount(0)
      await expect(settingsNote(sheet)).toHaveCount(0)
      await saveConfig(sheet)
      await expect(badge).toHaveCount(0)
      await saveWorkbench(page)
      const stored = (await persistedValues(request, testId))[nodeId]
      expect(stored.connect_timeout).toBe(30)
      expect(stored.keep_alive_max_count).toBe(5)
    })
  })

  test('BND-4: out-of-range expressions are refused by each block at run time, before any session', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const fixture = loadFixture('fixture-bounds.json', randomUUID())
    const legs = RUN_LEGS.map((leg) => ({
      ...leg,
      blockId: nodeByDescription(fixture, leg.description).id as string,
      catchId: nodeByDescription(fixture, `Caught ${leg.description}`).id as string,
    }))
    const testId = await importValidateAndNavigate(page, fixture, { injectSsh: true, rejectRepairs: true })
    created.push(testId)

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])
    // Per PING-17 the form leaves an expression to the run.
    await expect(page.locator('[data-testid="node-validation-alert"]')).toHaveCount(0)

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND)
    const entries = await getLogEntries(page)
    const variables: SessionVariables = await getSessionVariables(page, await getActiveSessionId(page))

    for (const leg of legs) {
      await test.step(`${leg.description}: the Try/Catch holds "${leg.message}"`, async () => {
        expect(sessionValue(variables, `${leg.key}_caught`), `${leg.key} was caught`).toBe(true)
        const error = sessionValue(variables, `${leg.key}_error`) as Record<string, unknown>
        expect(error.message, leg.description).toBe(leg.message)
        expect(error.node_id, 'the error points at the SSH block').toBe(leg.blockId)
        expect(error.element_type).toBe(leg.elementType)
        await expectNodeStatus(page, leg.blockId, 'failed')
        await expectNodeStatus(page, leg.catchId, 'success')
        expectConsoleLine(entries, 'WARN', `bnd caught ${leg.key}`)
      })
    }

    await test.step('each refusal is the bound itself, and no block opened a connection', () => {
      const caught = entries
        .filter((entry) => entry.level === 'WARN' && entry.message.startsWith(CAUGHT_PREFIX))
        .map((entry) => entry.message.slice(CAUGHT_PREFIX.length))
      expect(caught.sort(), formatEntries(entries)).toEqual(legs.map((leg) => leg.message).sort())
      expect(
        entries.filter((entry) => entry.message.startsWith('Connecting to ')),
        formatEntries(entries),
      ).toEqual([])
    })
  })
})
