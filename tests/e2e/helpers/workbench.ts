/**
 * Workbench-toolbar + canvas-interaction helpers shared by the undo/redo and
 * run-current functional specs (REQ-5.2.1.24).
 *
 * Centralizes the patterns those specs repeat: toolbar locators, the
 * retry-hardened node drag verified through the React Flow wrapper transform,
 * environment selection, run-to-terminal, context-menu node toggles, the
 * Radix pointer-events unlock, and the config-modal pinned-version probe.
 */

import { errors } from '@playwright/test'
import { expect, type Locator, type Page } from './playwright-fixtures'
import {
  clickNodeKebabItem,
  dragPaletteItemToCanvas,
  dragSourceToCanvas,
  expandPalette,
  expectNodeKebabItem,
  type PaletteDragSpec,
} from './canvas'
import { leaveExpressionEditor } from './code-editor'
import { setRowExpression } from './config-sheet'
import { BACKEND_URL, E2E_ENV_NAME } from './config'
import { getLogEntries, type LogEntry } from './log-reader'
import { openEditWindow, saveWindow, setWindowValue, variableRow, type WindowValue } from './variable-create'

export const undoBtn = (page: Page): Locator =>
  page.locator('[data-testid="toolbar-undo-button"]')
export const redoBtn = (page: Page): Locator =>
  page.locator('[data-testid="toolbar-redo-button"]')
export const saveBtn = (page: Page): Locator =>
  page.locator('[data-testid="toolbar-save-button"]')

export async function clickUndo(page: Page): Promise<void> {
  await expect(undoBtn(page)).toBeEnabled()
  await undoBtn(page).click()
}

export async function clickRedo(page: Page): Promise<void> {
  await expect(redoBtn(page)).toBeEnabled()
  await redoBtn(page).click()
}

/** The node's position read from the React Flow wrapper's inline transform.
 *  Canvas-coords, so invariant under viewport pan/zoom (bounding boxes are not). */
export async function readNodeTransform(page: Page, nodeId: string): Promise<string> {
  return await page
    .locator(`[data-testid="workflow-node-${nodeId}"]`)
    .evaluate((el) => {
      const rfNode = el.closest('.react-flow__node')
      return rfNode ? (rfNode as HTMLElement).style.transform : ''
    })
}

export interface DragResult {
  before: string
  after: string
}

/** Drag a node by (dx, dy), retrying until the move registers (a synthetic
 *  drag can slide the node visually without committing under shard load).
 *  Returns the before/after transforms for undo/redo position assertions. */
export async function dragNodeBy(
  page: Page,
  nodeId: string,
  opts: { dx?: number; dy?: number; confirmTestId?: string } = {},
): Promise<DragResult> {
  const dx = opts.dx ?? 90
  const dy = opts.dy ?? 60
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  const before = await readNodeTransform(page, nodeId)
  await expect(async () => {
    const box = await node.boundingBox()
    if (!box) throw new Error(`node ${nodeId} not found for drag`)
    const sx = box.x + box.width / 2
    const sy = box.y + box.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(sx + (dx * i) / 8, sy + (dy * i) / 8)
    await page.mouse.up()
    const moved = await readNodeTransform(page, nodeId)
    if (moved === before) throw new Error('drag did not register; retrying')
    if (opts.confirmTestId) {
      await expect(page.locator(`[data-testid="${opts.confirmTestId}"]`)).toBeEnabled({
        timeout: 1500,
      })
    }
  }).toPass({ timeout: 15_000 })
  await page.waitForTimeout(200)
  return { before, after: await readNodeTransform(page, nodeId) }
}

/** Pick the shared E2E execution environment in the toolbar selector. */
export async function selectEnvironment(page: Page): Promise<void> {
  const selector = page.locator('[data-testid="environment-selector"]')
  const popover = page.locator('[data-testid="environment-popover"]')
  // The read-only EnvReadout reuses this testid; a click on it silently no-ops.
  await expect(
    selector,
    'environment-selector must be the interactive picker, not the read-only readout',
  ).toBeEnabled({ timeout: 10_000 })
  // Retry the trigger open: under container-shard load a transient canvas overlay
  // (or a leftover Radix pointer lock from a prior menu) can swallow the first
  // click, otherwise hitting the 15s actionability timeout.
  await expect(async () => {
    await selector.click({ timeout: 5000 })
    await expect(popover).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30000 })
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

/** Re-read the run status every 25-100 ms until `matches` holds, failing at `timeout` as the status assertion after it would. */
export async function pollRunStatus(
  status: Locator,
  matches: (value: string | null) => boolean,
  timeout: number,
  message: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        // Only a missing element retries, as the web-first assertion does; any other failure fails at once.
        const value = await status.getAttribute('data-status').catch((error: unknown) => {
          if (error instanceof errors.TimeoutError) return undefined
          throw error
        })
        if (value === undefined) return 'unreadable'
        return matches(value) || value
      },
      // A fresh array each call: the poll consumes the one it is given.
      { timeout, intervals: [25, 50, 100], message },
    )
    .toBe(true)
}

/** Click Run and wait for a terminal state (default: passed/success). */
export async function runToTerminal(page: Page): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
  await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })
}

/** Right-click a node and click a context-menu item (Disable / Enable / Skip / Unskip). */
export async function clickNodeContextMenuItem(
  page: Page,
  nodeId: string,
  itemName: string | RegExp,
): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  const item = page.locator('[role="menu"]').getByRole('menuitem', { name: itemName })
  await expect(async () => {
    await node.click({ button: 'right' })
    await item.click({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await expect(page.locator('[role="menu"]')).not.toBeVisible()
}

/** Disable a node via the context menu and wait for the data-disabled stamp. */
export async function disableNode(page: Page, nodeId: string): Promise<void> {
  await clickNodeContextMenuItem(page, nodeId, 'Disable')
  await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute(
    'data-disabled',
    'true',
  )
}

/** Drill into a Function node via its dig-in glyph. */
export async function digIn(page: Page, nodeId: string): Promise<void> {
  await page
    .locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-dig-in"]`)
    .click()
}

/** Click an intermediate breadcrumb segment (pops the drill to that scope).
 *  Falls back to the "..." parents popover when the path is width-collapsed. */
export async function popToBreadcrumbSegment(page: Page, name: string | RegExp): Promise<void> {
  const bc = page.locator('[data-testid="canvas-breadcrumb"]')
  const link = bc.locator('a').filter({ hasText: name }).first()
  if (await link.isVisible().catch(() => false)) {
    await link.click()
    return
  }
  await bc.locator('[data-testid="breadcrumb-collapse-button"]').click()
  const list = page.locator('[data-testid="breadcrumb-parents-list"]')
  await expect(list).toBeVisible()
  await list.getByText(name).first().click()
  await expect(list).not.toBeVisible()
}

/** Count of violet Function segments in the breadcrumb (drill depth). */
export function breadcrumbFunctionSegments(page: Page): Locator {
  return page
    .locator('[data-testid="canvas-breadcrumb"]')
    .locator('svg.lucide-square-function')
}

/** Clear the pointer-events lock Radix AlertDialog can leave on <html>/<body>
 *  after a fast headless close. */
export async function clearPointerLock(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.pointerEvents = ''
    document.body.style.pointerEvents = ''
  })
}

/** The open Block window(s): every Block, Function Blocks included, uses the one window (CANVAS-207). */
export function configSheet(page: Page): Locator {
  return page.locator('[data-testid="element-config-sheet"]')
}

/** Click a configure cog until the config sheet shows; a click lost under load is retried. */
async function openSheetFrom(page: Page, configure: Locator): Promise<Locator> {
  const sheet = configSheet(page)
  await expect(async () => {
    await configure.dispatchEvent('click')
    await expect(sheet).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  return sheet
}

/** Open a Block's config sheet from its cog. */
export async function openBlockSheet(page: Page, blockId: string): Promise<Locator> {
  return openNodeSheet(page, page.locator(`[data-testid="workflow-node-${blockId}"]`))
}

/** Open the config sheet of the Block a canvas node locator points at, from its cog. */
export async function openNodeSheet(page: Page, node: Locator): Promise<Locator> {
  return openSheetFrom(page, node.locator('[data-testid="node-configure"]'))
}

/** Open the config sheet of the selected Block, the one whose cog shows. */
export async function openSelectedBlockSheet(page: Page): Promise<Locator> {
  return openSheetFrom(page, page.locator('[data-testid="node-configure"]'))
}

export async function saveBlockSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(sheet).toHaveCount(0)
}

/** Switch a Block setting to an expression (when it is not one yet), replace its text in one
 *  input so quote and bracket pairing leaves it alone, and Save the sheet. */
export async function setBlockExpression(
  page: Page,
  blockId: string,
  setting: string,
  expression: string,
): Promise<void> {
  const sheet = await openBlockSheet(page, blockId)
  const editor = sheet.locator(`[data-testid="param-input-${setting}"] .cm-content`)
  if (!(await editor.isVisible())) {
    await sheet.locator(`[data-testid="param-row-${setting}"] [data-testid="expression-toggle"]`).click()
  }
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(expression)
  await expect(editor).toHaveText(expression)
  await leaveExpressionEditor(editor)
  await saveBlockSheet(sheet)
}

/** Ids of every Block on the visible canvas scope. */
export async function canvasBlockIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('workflow-node-', '')),
    )
}

/** Drop a palette item (or a drag source such as the New Function handle) just below the
 *  visible scope's Start so it links from Start; returns the new Block id. */
export async function dropBelowStart(
  page: Page,
  source: PaletteDragSpec | Locator,
): Promise<string> {
  await expandPalette(page)
  const handle = page.locator('[data-testid="start-node"] .react-flow__handle').first()
  await expect(handle).toBeVisible()
  const dot = await handle.boundingBox()
  const canvas = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  expect(dot && canvas, 'the Start dot and the canvas have boxes').toBeTruthy()
  const point = {
    x: dot!.x + dot!.width / 2 - canvas!.x,
    y: dot!.y + dot!.height + 24 - canvas!.y,
  }
  const before = await canvasBlockIds(page)
  if (typeof source === 'string' || 'term' in source) {
    await dragPaletteItemToCanvas(page, source, point)
  } else {
    await dragSourceToCanvas(page, source, point)
  }
  const added = (await canvasBlockIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one Block was added').toHaveLength(1)
  await expect(
    page.locator(`[data-testid="rf__edge-edge-start-node-${added[0]}"]`),
    'the dropped Block links from Start',
  ).toHaveCount(1)
  return added[0]
}

/** Toolbar Save; a blocked save leaves the button enabled and fails here. */
export async function saveTest(page: Page): Promise<void> {
  await expect(saveBtn(page)).toBeEnabled({ timeout: 10_000 })
  await saveBtn(page).click()
  await expect(saveBtn(page), 'the Test saved (no blocking dialog)').toBeDisabled({
    timeout: 15_000,
  })
}

const RUN_CLOSING_LINE = /^Test '.*' (completed successfully|failed: |halted with status: )/

/** Click Run, wait for the run's closing console line, and return the verdict and the console
 *  entries whatever the verdict. */
export async function runToEnd(
  page: Page,
): Promise<{ verdict: string | null; entries: LogEntry[] }> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await pollRunStatus(
    status,
    (value) => value !== null && /passed|failed|stopped|skipped/.test(value),
    120_000,
    'the run reaches a terminal state',
  )
  await expect(status).toHaveAttribute('data-status', /passed|failed|stopped|skipped/, {
    timeout: 120_000,
  })
  let entries: LogEntry[] = []
  await expect
    .poll(
      async () => {
        entries = await getLogEntries(page)
        return entries.some((entry) => RUN_CLOSING_LINE.test(entry.message))
      },
      { timeout: 30_000, message: 'the run printed its closing console line' },
    )
    .toBe(true)
  return { verdict: await status.getAttribute('data-status'), entries }
}

/** Open the node's config sheet and assert the pinned version shown by the
 *  version dropdown trigger, then close the sheet. */
export async function expectPinnedVersion(
  page: Page,
  nodeId: string,
  version: string,
): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expect(dialog.locator('[data-testid="version-dropdown-trigger"]')).toContainText(
    `v${version}`,
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden({ timeout: 5_000 })
  await clearPointerLock(page)
}

/** The edit-mode asterisk overlay of a Function node. */
export function editModeOverlay(page: Page, nodeId: string): Locator {
  return page.locator(
    `[data-testid="workflow-node-${nodeId}"] [data-testid="edit-mode-mark-wrapper"]`,
  )
}

/** Assert a kebab item exists, then CLOSE the menu - an open Radix menu locks
 *  pointer events on <body>, blocking any toolbar click that follows. */
export async function expectNodeKebabItemThenClose(
  page: Page,
  nodeId: string,
  itemName: string | RegExp,
): Promise<void> {
  await expectNodeKebabItem(page, nodeId, itemName)
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="menu"]')).not.toBeVisible()
  await clearPointerLock(page)
}

/** The Save warning a block Save opens before it makes existing plain variables secret (SECUI-12). */
export function secretPromoteDialog(page: Page): Locator {
  return page.locator('[data-testid="secret-promote-dialog"]')
}

/** Check the open Save warning names exactly `names` (any order), then "Make secret and save". */
export async function confirmSecretPromotion(page: Page, names: string[]): Promise<void> {
  const dialog = secretPromoteDialog(page)
  await expect(dialog, 'the Save warning opened').toBeVisible()
  const title =
    names.length === 1 ? 'Make this variable secret?' : `Make ${names.length} variables secret?`
  await expect(dialog.getByRole('heading')).toHaveText(title)
  if (names.length === 1) {
    await expect(dialog.locator('code'), 'the warning names the variable').toHaveText(names[0])
  } else {
    const items = dialog.locator('[data-item-list] li')
    await expect(items).toHaveCount(names.length)
    expect((await items.allTextContents()).map((name) => name.trim()).sort()).toEqual(
      [...names].sort(),
    )
  }
  await dialog.getByRole('button', { name: 'Make secret and save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

/** Open a Function Block's window by double-clicking the Block. */
export async function openFunctionBlockSheet(page: Page, nodeId: string): Promise<Locator> {
  const sheet = configSheet(page)
  const block = page.locator(`[data-testid="workflow-node-${nodeId}"]`).locator('button').first()
  await expect(async () => {
    if (!(await sheet.isVisible())) await block.dblclick()
    await expect(sheet).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 15_000 })
  return sheet
}

/** Reset the run from the breadcrumb Reset link; a session holding artifacts confirms in the Reset Session? dialog. */
export async function resetRun(page: Page): Promise<void> {
  const artifactCount = await page.request
    .get(`${BACKEND_URL}/workbench/session/artifacts`)
    .then(async (resp) => (resp.ok() ? (((await resp.json()).items ?? []).length as number) : 0))
    .catch(() => 0)
  await page.locator('[data-testid="breadcrumb-reset-link"]').click()
  if (artifactCount > 0) {
    const dialog = page.getByRole('alertdialog').filter({ hasText: 'Reset Session?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(dialog).not.toBeVisible()
  }
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', 'idle', {
    timeout: 30_000,
  })
  if (artifactCount === 0) {
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
  }
}

/** Give a variable or Function input a Current value in its Edit window; returns its watcher, opened on Current. */
export async function setCurrentValue(page: Page, name: string, value: WindowValue): Promise<Locator> {
  const win = await openEditWindow(page, name, { view: 'Current' })
  await setWindowValue(page, win, value)
  await saveWindow(page, win)
  const watcher = page.locator(`section[aria-label="Inspect variable ${name}"]`)
  const row = variableRow(page, name)
  const expand = row.locator('[data-testid^="expand-button-"]')
  // A saved secret's watcher is locked: there is nothing to open.
  if ((await watcher.count()) === 0 && (await expand.getAttribute('aria-disabled')) !== 'true') {
    await row.hover()
    await expand.click()
    await expect(watcher).toBeVisible()
    await expect(watcher.locator('[data-testid="mode-dropdown"]')).toHaveText('Current')
  }
  return watcher
}

/** Drag a library Function card from the Functions Library sheet to just below `dot` (an exit or lane dot); returns the new Block id. */
export async function dropLibraryFunctionBelow(page: Page, name: string, dot: Locator): Promise<string> {
  await expandPalette(page)
  const anchor = await dot.boundingBox()
  const canvas = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  expect(anchor && canvas, 'the dot and the canvas have boxes').toBeTruthy()
  await page.locator('[data-testid="palette-blocks-library-button"]').click()
  const library = page.locator('[data-testid="functions-library"]')
  await expect(library).toBeVisible({ timeout: 10_000 })
  // The sheet opens centered over the canvas: move it to the side away from the dot so the drop lands on the canvas.
  const sheetBox = await library.boundingBox()
  const grip = await page.locator('[data-testid="functions-library-drag-handle"]').boundingBox()
  const viewport = page.viewportSize()
  expect(sheetBox && grip && viewport, 'the library sheet and its handle have boxes').toBeTruthy()
  const toLeft = anchor!.x > viewport!.width / 2
  const dx = (toLeft ? 0 : viewport!.width - sheetBox!.width) - sheetBox!.x
  const gx = grip!.x + grip!.width / 2
  const gy = grip!.y + grip!.height / 2
  await page.mouse.move(gx, gy)
  await page.mouse.down()
  await page.mouse.move(gx + dx, gy, { steps: 10 })
  await page.mouse.up()
  const moved = await library.boundingBox()
  expect(
    moved!.x > anchor!.x + anchor!.width || moved!.x + moved!.width < anchor!.x,
    'the library sheet no longer covers the dot',
  ).toBe(true)
  await library
    .locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]')
    .first()
    .fill(name)
  const card = library.locator('[data-testid="library-card"]').filter({ hasText: name }).first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  const before = await canvasBlockIds(page)
  await dragSourceToCanvas(page, card, {
    x: anchor!.x + anchor!.width / 2 - canvas!.x,
    y: anchor!.y + anchor!.height + 24 - canvas!.y,
  })
  const added = (await canvasBlockIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one Block was added').toHaveLength(1)
  await library.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(library).toHaveCount(0)
  return added[0]
}

/** Drag a library Function card from the Functions Library sheet to just below Start; returns the new Block id. */
export async function dropLibraryFunctionBelowStart(page: Page, name: string): Promise<string> {
  const blockId = await dropLibraryFunctionBelow(
    page,
    name,
    page.locator('[data-testid="start-node"] .react-flow__handle').first(),
  )
  await expect(
    page.locator(`[data-testid="rf__edge-edge-start-node-${blockId}"]`),
    'the dropped Block links from Start',
  ).toHaveCount(1)
  return blockId
}

/** Bind a Function Block input to an expression in the Block's sheet and Save the sheet. */
export async function bindFunctionInputExpression(
  page: Page,
  blockId: string,
  input: string,
  expression: string,
): Promise<void> {
  const sheet = await openFunctionBlockSheet(page, blockId)
  const row = sheet.locator(`[data-testid="param-row-${input}"]`)
  await expect(row, `the Block's sheet lists the input ${input}`).toBeVisible()
  // A field holding a value asks before it switches (FIELD-7); the shared driver answers it.
  await setRowExpression(page, sheet, input, expression)
  await saveBlockSheet(sheet)
}

/** Publish a Local Function from its kebab under `name` and return the new library Function id. */
export async function publishToLibrary(page: Page, nodeId: string, name: string): Promise<string> {
  await clickNodeKebabItem(page, nodeId, 'Publish to Library')
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.locator('[data-testid="publish-name-input"]').fill(name)
  const answer = page.waitForResponse(
    (resp) =>
      resp.request().method() === 'POST' &&
      /\/functions(\/publish)?$/.test(new URL(resp.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Publish' }).click()
  const resp = await answer
  expect(resp.ok(), `publish answered ${resp.status()}: ${await resp.text()}`).toBe(true)
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  await expect(
    page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-function-lifecycle-badge"]`),
    'the published Function Block is a Shared one',
  ).toHaveAttribute('data-state', 'shared')
  const list = await page.request.get(`${BACKEND_URL}/functions?q=${encodeURIComponent(name)}`)
  const rows = ((await list.json()).data ?? []) as Array<{ id: string; name: string }>
  const entry = rows.find((row) => row.name === name)
  expect(entry, `library entry ${name} exists after publish`).toBeTruthy()
  return (entry as { id: string }).id
}
