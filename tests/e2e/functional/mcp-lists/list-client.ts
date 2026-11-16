/** One-shot MCP tool calls that keep every row of a listing answer, plus the seeds the list specs share. */

import { expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL } from '../../helpers/config'
import { callToolItems, type McpTextItems } from '../../helpers/mcp'

// One MCP port per stack so host-mode parallel workers never collide.
export const MCP_PORT = Number(BACKEND_PORT) + 765

export const MASK = '********'

type McpAnswer = McpTextItems

/** Call one tool on the stack's MCP endpoint and keep every text item it answers. */
export function callMcp(tool: string, args: Record<string, unknown> = {}, clientName?: string): McpAnswer {
  return callToolItems(MCP_PORT, tool, args, clientName)
}

/** The rows of a listing answer: one JSON object per text item. */
export function rowsOf(answer: McpAnswer, tool: string): Array<Record<string, any>> {
  expect(answer.isError, `${tool} must answer rows: ${answer.texts.join('\n')}`).toBe(false)
  return answer.texts.map((text) => JSON.parse(text) as Record<string, any>)
}

/** The one object a tool answers. */
export function objectOf(answer: McpAnswer, tool: string): Record<string, any> {
  const rows = rowsOf(answer, tool)
  expect(rows, `${tool} must answer exactly one object`).toHaveLength(1)
  return rows[0]
}

/** A raised refusal: an error answer whose only text names the tool and carries the exact message. */
export function expectRaised(answer: McpAnswer, tool: string, message: string): void {
  expect(answer.isError, `${tool} must raise, not answer: ${answer.texts.join('\n')}`).toBe(true)
  expect(answer.texts).toEqual([`Error executing tool ${tool}: ${message}`])
}

/** A raised argument error: the SDK refuses a value of the wrong type before the tool runs. */
export function expectWrongType(answer: McpAnswer, tool: string, field: string, expected: string): void {
  expect(answer.isError, `${tool} must refuse ${field}: ${answer.texts.join('\n')}`).toBe(true)
  expect(answer.texts).toHaveLength(1)
  const prefix = `Error executing tool ${tool}: 1 validation error for ${tool}Arguments\n${field}\n  Input should be ${expected}`
  expect(answer.texts[0].startsWith(prefix), `expected the text to start with:\n${prefix}\ngot:\n${answer.texts[0]}`).toBe(true)
}

/** The rows whose name starts with the spec's own prefix. */
export function own<T extends { name?: unknown }>(rows: T[], prefix: string): T[] {
  return rows.filter((row) => String(row.name ?? '').startsWith(prefix))
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

const NODE_DIMS = { width: 120, height: 62 }

/** A Log Block whose message is an expression. */
export function logNode(id: string, label: string, message: string, y: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 400, y },
    data: {
      label,
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: label,
      expressionFields: ['message'],
      templateFields: [],
      config: { values: { message, level: 'INFO' }, outputBindings: {}, profileBindings: [] },
    },
    measured: { ...NODE_DIMS },
  }
}

/** A single Assert Block whose expression decides the run. */
export function assertNode(id: string, label: string, expression: string, y: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 400, y },
    data: {
      label,
      elementType: 'assert',
      nodeType: 'control',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      config: {
        values: {
          mode: 'single',
          assertions: [{ id: `${id}-check`, type: 'expression', expression }],
          fail_current_scope: true,
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { ...NODE_DIMS },
  }
}

/** Nodes chained from Start in the order given. */
export function chain(nodes: Array<Record<string, unknown>>): Record<string, unknown> {
  const ids = ['start-node', ...nodes.map((node) => String(node.id))]
  const edges = ids.slice(1).map((target, i) => ({ id: `e-${ids[i]}-${target}`, source: ids[i], target }))
  return { nodes, edges }
}

/** A Test that logs one line and passes. */
export function passingTest(id: string): Record<string, unknown> {
  return chain([logNode(`${id}-log`, 'Say passed', "'listing passed'", 150)])
}

/** A Test whose Assert fails the run. */
export function failingTest(id: string): Record<string, unknown> {
  return chain([
    logNode(`${id}-log`, 'Say failing', "'listing failing'", 150),
    assertNode(`${id}-gate`, 'Gate', "mode == 'down'", 260),
  ])
}

/** Create a Test through POST /tests and prove it validates clean; returns its id. */
export async function seedTest(
  request: APIRequestContext,
  body: { name: string; description: string; workflow: Record<string, unknown>; tags?: string[]; variables?: Record<string, unknown> },
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: body.name,
      description: body.description,
      workflow: body.workflow,
      variables: body.variables ?? { mode: { type: 'string', value: 'up' } },
      metadata: { tags: body.tags ?? [] },
    },
  })
  const created = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(created)}`).toBeTruthy()
  const testId = String(created.data.id)
  const validation = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const result = (await validation.json()).data ?? {}
  expect(result.errors ?? [], `${body.name} validates clean: ${JSON.stringify(result.errors)}`).toEqual([])
  return testId
}

/** Delete every Test whose name starts with the prefix, such as one a crashed run left behind. */
export async function purgeTests(request: APIRequestContext, prefix: string): Promise<void> {
  const resp = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(prefix)}&per_page=100`)
  const body = await resp.json().catch(() => null)
  const rows = (body?.data?.tests ?? body?.data ?? []) as Array<{ id: string; name: string }>
  for (const row of rows.filter((entry) => entry.name.startsWith(prefix))) {
    await request.delete(`${BACKEND_URL}/tests/${row.id}`).catch(() => undefined)
  }
}

/** Start a tracked run through POST /executions; returns its id without waiting. */
export async function startTracked(
  request: APIRequestContext,
  type: 'test' | 'suite',
  id: string,
  environmentId: string,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/executions`, {
    data: { type, id, environment_id: environmentId },
  })
  expect(resp.ok(), `POST /executions failed: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return String((body.data ?? body).id)
}

const TERMINAL = new Set(['passed', 'failed', 'stopped'])

/** Poll GET /executions/{id} until the status is one of the wanted ones; returns it. */
export async function waitForStatus(
  request: APIRequestContext,
  executionId: string,
  wanted: (status: string) => boolean = (status) => TERMINAL.has(status),
  timeout = 120_000,
): Promise<string> {
  let status = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        if (!resp.ok()) return false
        status = String(((await resp.json()).data ?? {}).status ?? '')
        return wanted(status)
      },
      { timeout, intervals: [200, 500, 1_000], message: `execution ${executionId} status` },
    )
    .toBe(true)
  return status
}

/** The stored execution as GET /executions/{id} answers it. */
export async function getExecution(request: APIRequestContext, executionId: string): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
  expect(resp.ok(), `GET /executions/${executionId}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data
}
