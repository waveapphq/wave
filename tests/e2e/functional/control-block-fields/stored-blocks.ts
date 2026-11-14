/** Stored Test and canvas Block reads for the control Block field specs. */

import fs from 'fs'
import path from 'path'
import { expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

export interface StoredEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

export interface StoredNode {
  id: string
  data: {
    expressionFields?: string[]
    config: { values: Record<string, unknown> } & Record<string, unknown>
  } & Record<string, unknown>
}

export interface StoredWorkflow {
  nodes: StoredNode[]
  edges: StoredEdge[]
}

/** A fixture of this folder, parsed fresh on each call. */
export function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf-8'))
}

/** The stored Test's workflow, read through `GET /tests/{id}`. */
export async function storedWorkflow(request: APIRequestContext, testId: string): Promise<StoredWorkflow> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return (body.data ?? body).workflow as StoredWorkflow
}

export function nodeOf(workflow: StoredWorkflow, id: string): StoredNode {
  const node = workflow.nodes.find((n) => n.id === id)
  expect(node, `the stored Test holds Block ${id}`).toBeTruthy()
  return node!
}

export function valuesOf(workflow: StoredWorkflow, id: string): Record<string, unknown> {
  return nodeOf(workflow, id).data.config.values
}

/** The stored edges out of `source` as sorted `[lane, target]` pairs; `null` is the single exit. */
export function lanesOut(workflow: StoredWorkflow, source: string): Array<[string | null, string]> {
  return workflow.edges
    .filter((e) => e.source === source)
    .map((e): [string | null, string] => [e.sourceHandle ?? null, e.target])
    .sort((a, b) => `${a[0]}>${a[1]}`.localeCompare(`${b[0]}>${b[1]}`))
}

/** Every stored edge whose source is not one of `sources`, as sorted `source:lane>target` keys. */
export function edgesBesides(workflow: StoredWorkflow, sources: readonly string[]): string[] {
  return workflow.edges
    .filter((e) => !sources.includes(e.source))
    .map((e) => `${e.source}:${e.sourceHandle ?? ''}>${e.target}`)
    .sort()
}

export async function deleteStoredTest(request: APIRequestContext, testId: string | undefined): Promise<void> {
  if (!testId) return
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
}

/** The data the canvas holds for a Block, read from the props its node component renders with. */
export async function canvasNodeData(page: Page, nodeId: string): Promise<unknown> {
  const data = await page.locator(`[data-testid="workflow-node-${nodeId}"]`).evaluate((el, id) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
    let fiber = key ? (el as unknown as Record<string, unknown>)[key] : null
    while (fiber && typeof fiber === 'object') {
      const node = fiber as { memoizedProps?: Record<string, unknown>; return?: unknown }
      const props = node.memoizedProps
      const held = props?.data as Record<string, unknown> | undefined
      if (props?.id === id && held && typeof held === 'object' && 'elementType' in held) {
        return JSON.parse(JSON.stringify(held)) as unknown
      }
      fiber = node.return
    }
    return null
  }, nodeId)
  expect(data, `the canvas renders Block ${nodeId} with its data`).not.toBeNull()
  return data
}

/** The unsaved-changes question of a Block window. */
export function unsavedQuestion(page: Page): Locator {
  return page.getByTestId('unsaved-changes-dialog')
}

/** Press Escape on an open Block window: it closes and asks nothing. */
export async function escapeAsksNothing(page: Page, sheet: Locator, what: string): Promise<void> {
  await page.keyboard.press('Escape')
  await expect
    .poll(
      async () => {
        if ((await unsavedQuestion(page).count()) > 0) return 'the unsaved-changes question is open'
        return (await sheet.count()) === 0 ? 'closed' : 'still open'
      },
      { message: `${what}: Escape closes the window without a question`, timeout: 10_000 },
    )
    .toBe('closed')
}
