/** Recipe tool calls over MCP shared by the recipe specs: finding rows, stored reads, tracked runs. */

import { expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, E2E_ENV_NAME } from '../../helpers/config'
import { runToken } from '../../helpers/element-types'
import { callTool } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'

// One MCP port per stack so host-mode parallel workers never collide.
export const MCP_PORT = Number(BACKEND_PORT) + 765

export type Doc = Record<string, any>

/** One finding of a recipe tool answer. */
export interface Finding {
  step: string
  code: string
  problem: string
  fix: string | null
}

/** A unique Test name for this run. */
export function uniqueName(base: string): string {
  return `${base} ${runToken()}`
}

/** Call one recipe tool and return its payload; a tool error fails here. */
export function tool(name: string, args: Record<string, unknown>): Doc {
  const answer = callTool(MCP_PORT, name, args)
  expect(answer.isError, `${name} must answer, not raise: ${JSON.stringify(answer.payload)}`).toBe(false)
  return answer.payload
}

/** The findings of a tool answer as `[step, code, problem, fix]` rows. */
export function rows(payload: Doc): Array<[string, string, string, string | null]> {
  return ((payload.findings ?? []) as Finding[]).map((f) => [f.step, f.code, f.problem, f.fix])
}

/** The findings of a tool answer that carry `code`. */
export function findingsOf(payload: Doc, code: string): Finding[] {
  return ((payload.findings ?? []) as Finding[]).filter((f) => f.code === code)
}

/** Create a Test from a recipe; the answer must say created. Returns its id. */
export function createFromRecipe(recipe: string): string {
  const created = tool('create_test_from_recipe', { recipe })
  // A held workbench slot also arrives here as created:false, hence the payload.
  expect(created.created, JSON.stringify(created)).toBe(true)
  return String(created.test_id)
}

/** Free the workbench slot so an amend can save. */
export async function freeSlot(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto('/tests')
  await resetOwnership(request)
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
}

/** The stored Test (`GET /tests/{id}`). */
export async function storedTestDoc(request: APIRequestContext, testId: string): Promise<Doc> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data as Doc
}

/** The stored Block holds `expression` in `setting` as an expression: the plain value it had is gone. */
export async function expectStoredExpression(
  request: APIRequestContext,
  testId: string,
  blockId: string,
  setting: string,
  expression: string,
): Promise<void> {
  const nodes = ((await storedTestDoc(request, testId)).workflow.nodes ?? []) as Doc[]
  const data = nodes.find((node) => String(node.id) === blockId)?.data as Doc | undefined
  expect(data, `Block ${blockId} is stored`).toBeTruthy()
  expect(data?.config?.values?.[setting], `stored ${setting} of Block ${blockId}`).toBe(expression)
  expect(data?.expressionFields ?? [], `${setting} is stored as an expression`).toContain(setting)
}

/** The ids of the stored Tests whose name is exactly `name`. */
export async function storedTestsNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}&per_page=100`)
  expect(resp.ok(), `GET /tests?search= failed: ${resp.status()}`).toBeTruthy()
  const rowsFound = ((await resp.json()).data ?? []) as Array<{ id: string; name: string }>
  return rowsFound.filter((row) => row.name === name).map((row) => row.id)
}

/** Replace the stored workflow through the REST write the canvas Save uses. */
export async function putWorkflow(request: APIRequestContext, testId: string, workflow: Doc): Promise<void> {
  const put = await request.put(`${BACKEND_URL}/tests/${testId}`, { data: { workflow } })
  expect(put.ok(), `PUT /tests/${testId} failed: ${put.status()} ${await put.text()}`).toBeTruthy()
}

const TERMINAL = ['passed', 'failed', 'stopped', 'skipped']

/** Run the Test tracked over MCP; returns the verdict and every non-DEBUG run line. */
export async function runOverMcp(
  request: APIRequestContext,
  testId: string,
): Promise<{ verdict: string; messages: string[] }> {
  const started = tool('start_execution', { entity_type: 'test', ref: testId, environment: E2E_ENV_NAME })
  const executionId = String(started.execution_id)
  let verdict = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        verdict = String(((await resp.json()).data ?? {}).status ?? '')
        return TERMINAL.includes(verdict)
      },
      { timeout: 90_000, message: `execution ${executionId} reaches a terminal state` },
    )
    .toBe(true)
  const history = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(history.ok(), `GET /executions/history/${executionId}: ${history.status()}`).toBeTruthy()
  const logs = (((await history.json()).data ?? {}).logs ?? []) as Array<{ level?: string; message?: string }>
  return {
    verdict,
    messages: logs.filter((line) => (line.level ?? '').toUpperCase() !== 'DEBUG').map((line) => line.message ?? ''),
  }
}
