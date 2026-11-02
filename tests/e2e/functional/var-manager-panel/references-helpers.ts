/** Shared drivers of the reference specs in this folder: blocks dropped and removed, the stored Test read back, renames and deletes in the Variable Manager. */

import { expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, dragSourceToCanvas, expandPalette, type PaletteDragSpec } from '../../helpers/canvas'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import { BACKEND_URL } from '../../helpers/config'
import { exprToggle, paramRow } from '../../helpers/config-sheet'
import { openEditWindow, renameInWindow, saveWindow, variableRow } from '../../helpers/variable-create'
import { canvasBlockIds, clickNodeContextMenuItem } from '../../helpers/workbench'

export interface StoredNode {
  id: string
  data: Record<string, unknown> & {
    label?: string
    config?: { values?: Record<string, unknown>; outputBindings?: Record<string, string> }
    expressionFields?: string[]
    templateFields?: string[]
    localDefinition?: { workflow?: { nodes?: StoredNode[] }; variables?: unknown }
  }
}

export interface StoredVariable {
  value: unknown
  type: string
  isExpression?: boolean
  isTemplate?: boolean
}

export interface StoredTest {
  workflow: { nodes: StoredNode[] }
  variables: Record<string, StoredVariable>
}

/** A Function Block field's stored expression, or undefined when the field holds no expression. */
export function expressionOf(node: StoredNode | undefined, field: string): unknown {
  if (!node?.data.expressionFields?.includes(field)) return undefined
  return node.data.config?.values?.[field]
}

export function uniqueName(prefix: string): string {
  return `zz-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function readStoredTest(page: Page, testId: string): Promise<StoredTest> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return (body.data ?? body) as StoredTest
}

export function storedNode(stored: StoredTest, id: string): StoredNode {
  const node = stored.workflow.nodes.find((n) => n.id === id)
  expect(node, `block ${id} is in the saved Test`).toBeTruthy()
  return node as StoredNode
}

/** A block inside a Local Function's body, as the saved Test holds it. */
export function storedBodyNode(stored: StoredTest, functionId: string, id: string): StoredNode {
  const body = storedNode(stored, functionId).data.localDefinition?.workflow?.nodes ?? []
  const node = body.find((n) => n.id === id)
  expect(node, `block ${id} is in the body of Function ${functionId}`).toBeTruthy()
  return node as StoredNode
}

/** Every JSON path whose key or string value names `name` as a whole identifier. */
export function pathsNaming(value: unknown, name: string, at = '$'): string[] {
  const word = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`)
  if (typeof value === 'string') return word.test(value) ? [`${at} = ${JSON.stringify(value)}`] : []
  if (Array.isArray(value)) return value.flatMap((item, i) => pathsNaming(item, name, `${at}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(word.test(key) ? [`${at} has key ${JSON.stringify(key)}`] : []),
      ...pathsNaming(item, name, `${at}.${key}`),
    ])
  }
  return []
}

export function unusedBadge(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="unused-badge-"]')
}

export async function canvasPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  expect(box, 'canvas box').toBeTruthy()
  return { x: Math.round(box!.width * fx), y: Math.round(box!.height * fy) }
}

async function onlyNewBlock(page: Page, before: readonly string[]): Promise<string> {
  const added = (await canvasBlockIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one block was added').toHaveLength(1)
  return added[0]
}

/** Drop a palette block at a fraction of the visible canvas; returns its id. */
export async function dropBlock(page: Page, spec: PaletteDragSpec, fx: number, fy: number): Promise<string> {
  const before = await canvasBlockIds(page)
  await dragPaletteItemToCanvas(page, spec, await canvasPoint(page, fx, fy))
  return onlyNewBlock(page, before)
}

/** Drop a new Local Function from the palette's New Function handle; returns its id. */
export async function dropLocalFunction(page: Page, fx: number, fy: number): Promise<string> {
  await expandPalette(page)
  const before = await canvasBlockIds(page)
  await dragSourceToCanvas(page, page.locator('[data-testid="palette-new-block-button"]'), await canvasPoint(page, fx, fy))
  return onlyNewBlock(page, before)
}

export async function zoomOut(page: Page, steps: number): Promise<void> {
  const button = page.locator('button.react-flow__controls-zoomout')
  for (let i = 0; i < steps; i++) await button.click()
}

/** Delete a block from its context menu and wait for it to leave the canvas. */
export async function deleteBlock(page: Page, blockId: string): Promise<void> {
  await clickNodeContextMenuItem(page, blockId, 'Delete')
  await expect(page.locator(`[data-testid="workflow-node-${blockId}"]`)).toHaveCount(0)
}

/** Replace a code editor's text in one input, so bracket and quote pairing leaves it alone. */
export async function replaceCode(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect(editor.locator('.cm-line')).toHaveText(text.split('\n'))
}

/** Switch an unbound Function Block input, which opens as its literal widget, to its expression editor. */
export async function openBindingEditor(sheet: Locator, input: string): Promise<Locator> {
  const toggle = exprToggle(sheet, input)
  // Per FNCFG-6: a Function Block input with nothing bound opens as its literal widget.
  await expect(toggle, `${input} opens literal`).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const editor = paramRow(sheet, input).locator(`[data-testid="param-input-${input}"] .cm-content`)
  await expect(editor).toBeVisible()
  return editor
}

/** Bind a Function Block input to an expression through its expression editor. */
export async function bindFunctionInput(page: Page, sheet: Locator, input: string, expression: string): Promise<void> {
  const editor = await openBindingEditor(sheet, input)
  await replaceCode(page, editor, expression)
  await leaveExpressionEditor(editor)
}

/** Rename a variable through its Edit window. */
export async function renameVariable(page: Page, from: string, to: string): Promise<void> {
  const win = await openEditWindow(page, from)
  await renameInWindow(win, to)
  await saveWindow(page, win)
  await expect(variableRow(page, to)).toBeVisible()
  await expect(variableRow(page, from)).toHaveCount(0)
}

/** Click a row's delete button; returns the confirmation dialog it opens. */
export async function openDeleteDialog(page: Page, name: string): Promise<Locator> {
  const row = variableRow(page, name)
  await row.hover()
  await row.locator('[data-testid^="delete-button-"]').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleName(`Delete "${name}"?`)
  return dialog
}

/** Delete a variable through its row and the confirmation dialog. */
export async function deleteVariable(page: Page, name: string): Promise<void> {
  const dialog = await openDeleteDialog(page, name)
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(variableRow(page, name)).toHaveCount(0)
}
