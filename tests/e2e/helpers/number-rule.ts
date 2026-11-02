/** Shared steps of the one number rule specs (REQ-3.1.3.14): save refusals, raw JSON bodies, sheet reads and DEBUG lines. */

import { execFileSync } from 'child_process'
import path from 'path'
import { expect, type APIRequestContext, type Locator, type Page } from './playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL } from './config'
import { mcpEndpointUrl, type McpToolResult } from './mcp'
import { BACKEND_DIR } from './spawn-backend'
import type { LogEntry } from './log-reader'

/** The MCP listener port the recipe specs share. */
export const NUMBER_MCP_PORT = Number(BACKEND_PORT) + 765

/** One save finding: its code and exact message. */
export type Finding = [code: string, message: string]

export interface SaveAnswer {
  status: number
  body: Record<string, any>
  /** `error.details` of a refused save, as code and message. */
  findings: Finding[]
}

function answerOf(status: number, body: Record<string, any>): SaveAnswer {
  const raw = body?.error?.details
  const details = (Array.isArray(raw) ? raw : (raw?.errors ?? [])) as Array<{ code?: string; message?: string }>
  return {
    status,
    body,
    findings: details.map((detail) => [String(detail.code), String(detail.message)] as Finding),
  }
}

/** Send a JSON body; `body` may be text, so a body can carry NaN or 30.0 the way a REST client writes it. */
export async function sendJson(
  request: APIRequestContext,
  method: 'POST' | 'PUT' | 'PATCH',
  route: string,
  body: Record<string, unknown> | string,
): Promise<SaveAnswer> {
  // A Buffer is sent as written: Playwright re-quotes a JSON string it cannot parse itself (NaN).
  const resp = await request.fetch(`${BACKEND_URL}${route}`, {
    method,
    data: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf-8'),
    headers: { 'content-type': 'application/json' },
  })
  return answerOf(resp.status(), (await resp.json().catch(() => ({}))) as Record<string, any>)
}

/** POST a JSON body (see `sendJson`). */
export async function postJson(
  request: APIRequestContext,
  route: string,
  body: Record<string, unknown> | string,
): Promise<SaveAnswer> {
  return sendJson(request, 'POST', route, body)
}

/** A Test save that must be refused: 422 and exactly these findings. */
export async function expectTestRefused(
  request: APIRequestContext,
  body: Record<string, unknown> | string,
  expected: Finding[],
): Promise<void> {
  const answer = await postJson(request, '/tests', body)
  if (answer.status < 300) await deleteTestQuietly(request, answer.body?.data?.id)
  expect(answer.status, `POST /tests answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(422)
  expect([...answer.findings].sort()).toEqual([...expected].sort())
}

/** A Function save that must be refused: 422 and exactly these findings. */
export async function expectFunctionRefused(
  request: APIRequestContext,
  body: Record<string, unknown> | string,
  expected: Finding[],
): Promise<void> {
  const answer = await postJson(request, '/functions', body)
  if (answer.status < 300) await deleteFunctionQuietly(request, answer.body?.data?.id)
  expect(answer.status, `POST /functions answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(422)
  expect([...answer.findings].sort()).toEqual([...expected].sort())
}

/** Create a Test through POST /tests and return its id. */
export async function createTest(request: APIRequestContext, body: Record<string, unknown> | string): Promise<string> {
  const answer = await postJson(request, '/tests', body)
  expect(answer.status, `POST /tests answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBeLessThan(300)
  return answer.body.data.id as string
}

export async function deleteTestQuietly(request: APIRequestContext, testId: string | undefined): Promise<void> {
  if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

export async function deleteFunctionQuietly(request: APIRequestContext, functionId: string | undefined): Promise<void> {
  if (functionId) await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`).catch(() => undefined)
}

/** A Function name under the 32-character cap: `zz-11541-s8-<what>-<8 hex>`. */
export function functionName(what: string): string {
  return `zz-11541-s8-${what}-${Math.random().toString(16).slice(2, 10)}`
}

/** A Function body for POST /functions with the given declarations and an empty flow. */
export function functionBody(name: string, declarations: Record<string, unknown>): Record<string, unknown> {
  return {
    name,
    description: 'One number rule probe',
    tags: [],
    inputs: [],
    outputs: [],
    variables: [],
    dependencies: { functions: [], plugins: [] },
    workflow: { nodes: [], edges: [] },
    version: '1.0.0',
    changelog: 'Initial release',
    details: '',
    ...declarations,
  }
}

/** The JSON text of `value` with every `"<placeholder>"` string replaced by raw JSON text (NaN, 30.0, 1e-7). */
export function rawJson(value: unknown, raw: Record<string, string>): string {
  return Object.entries(raw).reduce((text, [key, to]) => text.split(JSON.stringify(key)).join(to), JSON.stringify(value))
}

/** A deep copy with every `__KEY__` placeholder in every string replaced. */
export function withPlaceholders<T>(value: T, placeholders: Record<string, string>): T {
  const text = Object.entries(placeholders).reduce((acc, [key, to]) => acc.split(key).join(to), JSON.stringify(value))
  return JSON.parse(text) as T
}

type FixtureNode = { id: string; data: Record<string, any> }

/** The id of the fixture node whose description is `description`. */
export function nodeIdOf(fixture: Record<string, any>, description: string): string {
  const node = (fixture.workflow.nodes as FixtureNode[]).find((entry) => entry.data.description === description)
  expect(node, `fixture node "${description}"`).toBeTruthy()
  return (node as FixtureNode).id
}

/** A Test body of the fixture's one node `description`, wired from Start, its values merged with `values`. */
export function oneNodeTest(
  fixture: Record<string, any>,
  description: string,
  values: Record<string, unknown> = {},
): Record<string, any> {
  const node = structuredClone(
    (fixture.workflow.nodes as FixtureNode[]).find((entry) => entry.data.description === description),
  ) as FixtureNode
  expect(node, `fixture node "${description}"`).toBeTruthy()
  Object.assign(node.data.config.values, values)
  return {
    name: `zz-11541-s8-${description.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'One number rule save probe',
    workflow: { nodes: [node], edges: [{ id: `e-start-${node.id}`, source: 'start-node', target: node.id }] },
    variables: {},
    metadata: {},
  }
}

/** A stored node of the Test by id. */
export async function storedNode(
  request: APIRequestContext,
  testId: string,
  nodeId: string,
): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  const nodes = ((await resp.json()).data.workflow.nodes ?? []) as Array<Record<string, any>>
  const node = nodes.find((entry) => entry.id === nodeId)
  expect(node, `node ${nodeId} is stored`).toBeTruthy()
  return node as Record<string, any>
}

/** Type into a number box the way a person does: focus, select all, then key by key (a gray default takes the first key). */
export async function typeNumber(page: Page, box: Locator, text: string): Promise<void> {
  await box.click()
  await page.keyboard.press('ControlOrMeta+a')
  await box.pressSequentially(text)
  await expect(box).toHaveValue(text)
}

/** Empty a number box with select all and Delete: the field goes back to not set (its gray default, if any). */
export async function clearNumber(page: Page, box: Locator, shownAfter: string): Promise<void> {
  await box.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await expect(box).toHaveValue(shownAfter)
}

/** Expand a config sheet's parameter group card when it is collapsed. */
export async function openGroup(sheet: Locator, name: string): Promise<void> {
  const header = sheet.locator(`[data-testid="group-header-${name}"]`)
  await expect(header, `group "${name}"`).toBeVisible()
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** Answer an open "Unsaved changes" question with Close, discarding the edits; no question is fine. */
export async function closeUnsavedQuestion(page: Page): Promise<void> {
  const question = page.getByRole('dialog', { name: 'Unsaved changes' })
  if (await question.isVisible().catch(() => false)) {
    await question.locator('[data-testid="unsaved-close"], [data-testid="unsaved-discard"]').click()
    await expect(question).toBeHidden()
  }
}

/** Close a config sheet that may hold unsaved edits, discarding them. */
export async function discardSheet(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await closeUnsavedQuestion(page)
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

/** The tooltip lines of a canvas Block's issue badge. */
export async function badgeLines(page: Page, nodeId: string): Promise<string[]> {
  const badge = page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-validation-alert"]`)
  await expect(badge, 'the Block shows its issue badge').toBeVisible({ timeout: 10_000 })
  await badge.hover()
  const tooltip = page.locator('[role="tooltip"]').last()
  await expect(tooltip).toBeVisible({ timeout: 5_000 })
  const lines = (await tooltip.locator('li').allTextContents()).map((line) => line.trim())
  await page.mouse.move(0, 0)
  await expect(page.locator('[role="tooltip"]'), 'the badge tooltip closes').toHaveCount(0)
  return lines
}

/** The DEBUG `Inputs:` / `Outputs:` lines whose source ends with the Block name. */
export function ioLines(entries: readonly LogEntry[], blockName: string, kind: 'Inputs' | 'Outputs'): string[] {
  return entries
    .filter(
      (entry) =>
        entry.level === 'DEBUG' && entry.source.endsWith(blockName) && entry.message.startsWith(`${kind}: `),
    )
    .map((entry) => entry.message)
}

/** Call one MCP tool with its arguments written as raw JSON text, so an integer past 2^53 keeps every digit. */
export function callToolRaw(port: number, tool: string, argsJson: string): McpToolResult {
  const client = path.resolve(__dirname, '../functional/recipe-authoring/mcp_tool_client.py')
  const stdout = execFileSync('poetry', ['run', 'python', client, mcpEndpointUrl(port), tool], {
    cwd: BACKEND_DIR,
    input: argsJson,
    timeout: 90_000,
    encoding: 'utf-8',
  })
  return JSON.parse(stdout.trim().split('\n').pop() ?? '') as McpToolResult
}

/** Every error a recipe tool answered, as code and problem text (warnings left out). */
export function recipeErrors(result: McpToolResult): Finding[] {
  return ((result.payload.findings ?? []) as Array<{ code: string; problem: string; severity?: string }>)
    .filter((finding) => finding.severity !== 'warning')
    .map((finding) => [finding.code, finding.problem] as Finding)
}
