/** Function Block seeds in the stored field shape, save-refusal reads and Block window steps (REQ-3.1.2.1, REQ-3.1.2.4). */

import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Locator, type Page } from './playwright-fixtures'
import { BACKEND_URL } from './config'
import { leaveExpressionEditor } from './code-editor'
import { openBlockSheet } from './workbench'
import { waitForTooltipClosed, waitForTooltipVisible } from './tooltip-wait'

const OPEN_TOOLTIP = '[data-slot="tooltip-content"]:not([data-state="closed"])'

export type Rec = Record<string, unknown>

const NODE_DIMS = { width: 120, height: 62 }

/** A unique stream-owned name, `zz-11541-s7-<what>-<6 hex>`; a library Function name stays within 32 characters. */
export function zzName(what: string): string {
  return `zz-11541-s7-${what}-${randomUUID().slice(0, 6)}`
}

/** What a Block stores beside its type: its fields, their flags, its outputs and bindings. */
export interface BlockFields {
  values?: Rec
  expressionFields?: string[]
  templateFields?: string[]
  variableExpressionKeys?: string[]
  elementTypes?: Rec
  outputBindings?: Record<string, string>
  profileBindings?: Rec[]
  description?: string
  disabled?: boolean
  position?: { x: number; y: number }
}

function blockData(fields: BlockFields): Rec {
  const data: Rec = {
    expressionFields: fields.expressionFields ?? [],
    templateFields: fields.templateFields ?? [],
    variableExpressionKeys: fields.variableExpressionKeys ?? [],
    config: {
      values: fields.values ?? {},
      outputBindings: fields.outputBindings ?? {},
      profileBindings: fields.profileBindings ?? [],
    },
  }
  if (fields.elementTypes) data.elementTypes = fields.elementTypes
  if (fields.description !== undefined) data.description = fields.description
  if (fields.disabled) data.disabled = true
  return data
}

function workflowNode(id: string, data: Rec, position = { x: 200, y: 200 }): Rec {
  return { id, type: 'workflowNode', position, data, measured: { ...NODE_DIMS } }
}

/** A plugin Block of `elementType` holding `fields`. */
export function pluginBlock(id: string, label: string, elementType: string, category: string, fields: BlockFields = {}): Rec {
  return workflowNode(
    id,
    { label, elementType, nodeType: 'plugin', category, version: '1.0.0', ...blockData(fields) },
    fields.position,
  )
}

/** A control Block of `elementType` holding `fields`. */
export function controlBlock(id: string, label: string, elementType: string, category: string, fields: BlockFields = {}): Rec {
  return workflowNode(
    id,
    { label, elementType, nodeType: 'control', category, version: '1.0.0', ...blockData(fields) },
    fields.position,
  )
}

/** A Log whose message is an expression (the default) or, with `template`, a Template. */
export function logBlock(
  id: string,
  label: string,
  message: string,
  opts: BlockFields & { kind?: 'expression' | 'template' } = {},
): Rec {
  const kind = opts.kind ?? 'expression'
  return pluginBlock(id, label, 'log', 'system', {
    ...opts,
    values: { message, level: 'INFO', ...opts.values },
    expressionFields: kind === 'expression' ? ['message', ...(opts.expressionFields ?? [])] : opts.expressionFields,
    templateFields: kind === 'template' ? ['message', ...(opts.templateFields ?? [])] : opts.templateFields,
  })
}

/** A CSV Parser that parses two rows; its Row Count output is bound by `outputBindings`. */
export function csvBlock(id: string, label: string, opts: BlockFields = {}): Rec {
  return pluginBlock(id, label, 'csv-parser', 'data', {
    ...opts,
    values: { operation: 'parse', csv_content: 'a,b\n1,2\n3,4', delimiter: ',', has_header: true, ...opts.values },
  })
}

/** A Variable Setter writing `rows` (name -> value). */
export function setterBlock(id: string, label: string, rows: Rec, opts: BlockFields = {}): Rec {
  return controlBlock(id, label, 'variable-setter', 'variables', { ...opts, values: { variables: rows } })
}

/** A body of Blocks for a Local Function, a Shared draft or a library version. */
export interface FunctionBody {
  nodes: Rec[]
  edges?: Rec[]
  inputs?: Rec[]
  outputs?: Rec[]
  variables?: Rec[]
}

/** Edges from Start through `ids` in order. */
export function chainEdges(ids: readonly string[]): Rec[] {
  const chain = ['start-node', ...ids]
  return chain.slice(1).map((target, index) => ({ id: `e-${chain[index]}-${target}`, source: chain[index], target }))
}

function functionData(label: string, fields: BlockFields): Rec {
  return {
    label,
    elementType: 'function',
    nodeType: 'function',
    category: 'function',
    version: '1.0.0',
    hasNewerVersion: false,
    ...blockData(fields),
  }
}

/** A Local Function Block running `body`, its fields stored in `config.values` with their flags. */
export function localFunctionBlock(id: string, label: string, body: FunctionBody, fields: BlockFields = {}): Rec {
  return workflowNode(
    id,
    {
      ...functionData(label, fields),
      functionLifecycle: 'local',
      localDefinition: {
        name: label,
        inputs: body.inputs ?? [],
        outputs: body.outputs ?? [],
        variables: body.variables ?? [],
        workflow: { nodes: body.nodes, edges: body.edges ?? chainEdges(body.nodes.map((node) => String(node.id))) },
      },
    },
    fields.position ?? { x: 300, y: 200 },
  )
}

/** The library Function a Shared Function Block pins. */
export interface PinnedFunction {
  functionId: string
  version: string
  name: string
}

/** A Shared Function Block pinned to `pin`. */
export function sharedFunctionBlock(id: string, label: string, pin: PinnedFunction, fields: BlockFields = {}): Rec {
  return workflowNode(
    id,
    {
      ...functionData(label, fields),
      functionLifecycle: 'shared',
      functionId: pin.functionId,
      functionVersion: pin.version,
      originalLibraryName: pin.name,
    },
    fields.position ?? { x: 300, y: 200 },
  )
}

/** A Shared Function Block in edit mode whose draft runs `draft`. */
export function editModeFunctionBlock(
  id: string,
  label: string,
  pin: PinnedFunction,
  draft: FunctionBody & { description?: string },
  fields: BlockFields = {},
): Rec {
  const node = sharedFunctionBlock(id, label, pin, fields) as { data: Rec }
  node.data.editMode = true
  node.data.upstreamLink = { functionId: pin.functionId, sourceVersion: pin.version }
  node.data.draft = {
    name: pin.name,
    description: draft.description ?? '',
    tags: [],
    inputs: draft.inputs ?? [],
    outputs: draft.outputs ?? [],
    variables: draft.variables ?? [],
    dependencies: { functions: [], plugins: [] },
    workflow: { nodes: draft.nodes, edges: draft.edges ?? chainEdges(draft.nodes.map((node) => String(node.id))) },
  }
  return node as unknown as Rec
}

/** The `POST /functions` body that publishes `body` as version 1.0.0 of `name`. */
export function libraryFunction(name: string, body: FunctionBody, description = 'Function Block E2E library entry'): Rec {
  return {
    name,
    description,
    tags: [],
    inputs: body.inputs ?? [],
    outputs: body.outputs ?? [],
    variables: body.variables ?? [],
    dependencies: { functions: [], plugins: [] },
    workflow: { nodes: body.nodes, edges: body.edges ?? chainEdges(body.nodes.map((node) => String(node.id))) },
    version: '1.0.0',
    changelog: 'Initial release',
    details: 'Function Block E2E details',
  }
}

// ---------------------------------------------------------------------------
// Saves through the API and what they refuse
// ---------------------------------------------------------------------------

/** One finding of a refused save. */
export interface Finding {
  code: string
  message: string
}

/** The answer of a save: its HTTP status, the stored id when it saved, the findings when it did not. */
export interface SaveAnswer {
  status: number
  id: string | null
  findings: Finding[]
  body: Rec | null
}

async function answerOf(resp: { status(): number; json(): Promise<unknown> }): Promise<SaveAnswer> {
  const body = (await resp.json().catch(() => null)) as Rec | null
  const data = (body?.data ?? null) as Rec | null
  const error = (body?.error ?? null) as Rec | null
  const details = Array.isArray(error?.details) ? (error?.details as Rec[]) : []
  return {
    status: resp.status(),
    id: typeof data?.id === 'string' ? data.id : null,
    findings: details.map((entry) => ({ code: String(entry.code), message: String(entry.message) })),
    body,
  }
}

/** A Test to save: its name, root Blocks, edges and variables. */
export interface TestSpec {
  name: string
  nodes: Rec[]
  edges?: Rec[]
  variables?: Rec
}

/** Save a Test through `POST /tests`, the normal write path, and return what it answered. */
export async function postTest(request: APIRequestContext, spec: TestSpec): Promise<SaveAnswer> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: spec.name,
      version: '1.0.0',
      description: 'Function Block E2E',
      workflow: { nodes: spec.nodes, edges: spec.edges ?? chainEdges(spec.nodes.map((node) => String(node.id))) },
      variables: spec.variables ?? {},
      metadata: {},
    },
  })
  return answerOf(resp)
}

/** Save a Test that must save; returns its id. */
export async function createTest(request: APIRequestContext, spec: TestSpec): Promise<string> {
  const answer = await postTest(request, spec)
  expect(answer.status, `POST /tests saved ${spec.name}: ${JSON.stringify(answer.body)}`).toBe(201)
  return answer.id as string
}

/** Publish a library Function through `POST /functions` and return what it answered. */
export async function postFunction(request: APIRequestContext, payload: Rec): Promise<SaveAnswer> {
  return answerOf(await request.post(`${BACKEND_URL}/functions`, { data: payload }))
}

/** Publish a library Function that must save; returns its pin. */
export async function createFunction(request: APIRequestContext, payload: Rec): Promise<PinnedFunction> {
  const answer = await postFunction(request, payload)
  expect(answer.status, `POST /functions saved ${String(payload.name)}: ${JSON.stringify(answer.body)}`).toBe(201)
  return { functionId: answer.id as string, version: String(payload.version ?? '1.0.0'), name: String(payload.name) }
}

/** The messages of every finding of `code`. */
export function messagesOf(findings: readonly Finding[], code: string): string[] {
  return findings.filter((finding) => finding.code === code).map((finding) => finding.message)
}

/** The ids of the stored Tests named exactly `name`. */
export async function testIdsNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}&per_page=100`)
  const rows = ((await resp.json().catch(() => null))?.data ?? []) as Array<{ id: string; name: string }>
  return rows.filter((row) => row.name === name).map((row) => row.id)
}

/** The ids of the library Functions named exactly `name`. */
export async function functionIdsNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/functions?q=${encodeURIComponent(name)}`)
  const rows = ((await resp.json().catch(() => null))?.data ?? []) as Array<{ id: string; name: string }>
  return rows.filter((row) => row.name === name).map((row) => row.id)
}

/** Delete Tests and library Functions a spec made; a Function goes with every version (`cascade=true`). */
export async function cleanUp(request: APIRequestContext, testIds: string[], functionIds: string[] = []): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  for (const id of testIds.splice(0)) await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
  for (const id of functionIds.splice(0)) {
    await request.delete(`${BACKEND_URL}/functions/${id}?cascade=true`).catch(() => undefined)
  }
}

/** The stored Test (`GET /tests/{id}`). */
export async function storedTest(request: APIRequestContext, testId: string): Promise<Rec> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data as Rec
}

function bodyNodes(data: Rec): Rec[] {
  const holder = (data.editMode === true ? data.draft : data.localDefinition) as Rec | undefined
  return (((holder?.workflow as Rec | undefined)?.nodes ?? []) as Rec[])
}

/** A stored Block by its path of ids: a root Block, then a Block inside each Function flow on the way. */
export async function storedBlock(request: APIRequestContext, testId: string, ...path: string[]): Promise<Rec> {
  const test = await storedTest(request, testId)
  let nodes = ((test.workflow as Rec).nodes ?? []) as Rec[]
  let found: Rec | undefined
  for (const id of path) {
    found = nodes.find((node) => node.id === id)
    expect(found, `Block ${id} is stored (path ${path.join(' > ')})`).toBeTruthy()
    nodes = bodyNodes((found as Rec).data as Rec)
  }
  return (found as Rec).data as Rec
}

/** The stored `config` of a Block's data. */
export function configOf(data: Rec): Rec {
  return (data.config ?? {}) as Rec
}

// ---------------------------------------------------------------------------
// The Block window of a Function Block
// ---------------------------------------------------------------------------

/** Open a Block's window from its cog; every Block, Function Blocks included, opens the one Block window (CANVAS-207). */
export async function openBlockWindow(page: Page, blockId: string): Promise<Locator> {
  const sheet = await openBlockSheet(page, blockId)
  await expect(sheet).toHaveAttribute('data-testid', 'element-config-sheet')
  return sheet
}

export const fieldRow = (sheet: Locator, name: string): Locator => sheet.locator(`[data-testid="param-row-${name}"]`)
export const fieldToggle = (sheet: Locator, name: string): Locator =>
  fieldRow(sheet, name).locator('[data-testid="expression-toggle"]')
export const fieldExpand = (sheet: Locator, name: string): Locator => sheet.locator(`[data-testid="param-expand-${name}"]`)
export const fieldCode = (sheet: Locator, name: string): Locator =>
  fieldRow(sheet, name).locator(`[data-testid="param-input-${name}"] .cm-content`)
export const windowSave = (sheet: Locator): Locator => sheet.getByRole('button', { name: 'Save', exact: true })
export const valueSheet = (page: Page): Locator => page.locator('[data-testid="value-editor-sheet"]')

/** Save the Block window; it closes. */
export async function saveBlockWindow(sheet: Locator): Promise<void> {
  await expect(windowSave(sheet)).toBeEnabled()
  await windowSave(sheet).click()
  await expect(sheet).toHaveCount(0)
}

/** Close a Block window that holds no change. */
export async function closeBlockWindow(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(sheet).toHaveCount(0)
}

/** Replace the text of a CodeMirror editor in one input, so bracket and quote pairing leaves it alone. */
export async function replaceCode(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
  await expect(editor).toHaveText(text)
  await leaveExpressionEditor(editor)
}

/** Switch a field to {x} when it is not yet, and give it `expression`. */
export async function setFieldExpression(page: Page, sheet: Locator, name: string, expression: string): Promise<void> {
  const toggle = fieldToggle(sheet, name)
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await replaceCode(page, fieldCode(sheet, name), expression)
}

/** Open a field's editor from its expand icon; returns the Edit value sheet. */
export async function openFieldEditor(page: Page, sheet: Locator, name: string): Promise<Locator> {
  await fieldExpand(sheet, name).click()
  const editor = valueSheet(page)
  await expect(editor).toBeVisible()
  return editor
}

/** Apply the Edit value sheet and close it. */
export async function applyAndCloseValueSheet(editor: Locator): Promise<void> {
  const save = editor.getByTestId('value-editor-save-button')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toBeDisabled()
  await editor.getByTestId('value-editor-cancel-button').click()
  await expect(editor).toBeHidden()
}

/** Close an Edit value sheet that holds no change. */
export async function closeValueSheet(editor: Locator): Promise<void> {
  await expect(editor.getByTestId('value-editor-save-button')).toBeDisabled()
  await editor.getByTestId('value-editor-cancel-button').click()
  await expect(editor).toBeHidden()
}

/** Make a text field a Template holding `text` through its editor's Kind (REQ-3.1.3.15). */
export async function setFieldTemplate(page: Page, sheet: Locator, name: string, text: string): Promise<void> {
  const editor = await openFieldEditor(page, sheet, name)
  const kind = editor.getByTestId('kind-dropdown')
  await kind.click()
  await page.getByRole('option', { name: 'Template', exact: true }).click()
  await expect(kind).toHaveText('Template')
  await replaceCode(page, editor.locator('.cm-content').first(), text)
  await applyAndCloseValueSheet(editor)
}

/** Add a map entry `key` whose value is the {x} expression `expression`, in the field's map editor. */
export async function addMapEntryExpression(
  page: Page,
  sheet: Locator,
  name: string,
  key: string,
  expression: string,
): Promise<void> {
  const editor = await openFieldEditor(page, sheet, name)
  const index = await editor.locator('[data-testid^="map-edit-key-"]').count()
  await editor.getByTestId('map-add-entry').click()
  await editor.getByTestId(`map-edit-key-${index}`).fill(key)
  const toggle = editor.getByTestId(`map-expr-toggle-${index}`)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await replaceCode(page, editor.locator(`[data-testid="map-expr-value-${index}"] .cm-content`), expression)
  await applyAndCloseValueSheet(editor)
}

/** The completion labels the expression field `code` offers on Ctrl+Space with nothing typed. */
export async function offeredNames(page: Page, code: Locator): Promise<string[]> {
  await code.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+Space')
  const list = page.locator('.cm-tooltip-autocomplete')
  await expect(list).toBeVisible({ timeout: 5_000 })
  const labels = await list.locator('.cm-completionLabel').allTextContents()
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  return labels
}

// ---------------------------------------------------------------------------
// The canvas alert badge
// ---------------------------------------------------------------------------

/** A canvas Block's alert badge. */
export const alertBadge = (page: Page, blockId: string): Locator =>
  page.locator(`[data-testid="workflow-node-${blockId}"] [data-testid="node-validation-alert"]`)

/** The messages the Block's alert badge lists on hover; the tooltip is closed again before this returns. */
export async function badgeMessages(page: Page, blockId: string): Promise<string[]> {
  const badge = alertBadge(page, blockId)
  await expect(badge, `Block ${blockId} carries the alert badge`).toBeVisible({ timeout: 10_000 })
  await waitForTooltipClosed(page, `no tooltip is open before hovering the badge of ${blockId}`, 5_000)
  await badge.hover()
  await waitForTooltipVisible(page, `the badge tooltip of ${blockId}`, 5_000)
  const items = page.locator(`${OPEN_TOOLTIP} [role="tooltip"] li`)
  const messages = (await items.allTextContents()).map((text) => text.trim())
  await page.mouse.move(0, 0)
  await waitForTooltipClosed(page, `the badge tooltip of ${blockId} closes`, 5_000)
  return messages
}

/** Open a Block's menu and pick `item`; a long menu may run past the viewport, so the item is clicked in place. */
export async function pickBlockMenuItem(page: Page, blockId: string, item: RegExp): Promise<void> {
  const kebab = page.locator(`[data-testid="workflow-node-${blockId}"] [data-testid="node-kebab"]`)
  const entry = page.locator('[role="menu"]').getByRole('menuitem', { name: item })
  await expect(async () => {
    if ((await entry.count()) === 0) await kebab.click()
    await entry.dispatchEvent('click', undefined, { timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await expect(page.locator('[role="menu"]')).toHaveCount(0)
}
