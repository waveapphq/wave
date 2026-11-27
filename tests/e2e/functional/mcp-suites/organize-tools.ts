/** Seeding, cleanup and MCP answer checks shared by the Suite and Regression tool specs. */

import fs from 'fs'
import path from 'path'
import { expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL } from '../../helpers/config'
import { callToolItems, type McpToolResult } from '../../helpers/mcp'
import { setMasking } from '../secret-reveal-controls/masking-flags'

// The MCP port sits a fixed offset above the shard's backend port.
export const MCP_PORT = Number(BACKEND_PORT) + 765

/** The placeholder every read shows for a secret that holds a value. */
export const MASK = '********'

export type EntityRoute = '/tests' | '/suites' | '/regressions'

export interface Finding {
  step: string
  code: string
  severity: string
  problem: string
  fix: string | null
}

/** One input finding in the envelope the organize tools answer with. */
export function inputFinding(code: string, problem: string, fix: string | null = null): Finding {
  return { step: 'input', code, severity: 'error', problem, fix }
}

/** A refused write answers its boolean false and exactly these findings, never a raised error. */
export function expectRefused(result: McpToolResult, key: 'created' | 'updated', findings: Finding[]): void {
  expect(result.isError, `a refusal is a result, never a raised error: ${JSON.stringify(result.payload)}`).toBe(false)
  expect(result.payload).toEqual({ [key]: false, findings })
}

/** An unknown reference raises; the transport names the tool before the message. */
export function expectRaised(result: McpToolResult, tool: string, message: string): void {
  expect(result.isError, `${tool} must raise, not answer: ${JSON.stringify(result.payload)}`).toBe(true)
  expect(String(result.payload.text ?? JSON.stringify(result.payload))).toBe(
    `Error executing tool ${tool}: ${message}`,
  )
}

export interface McpRows {
  isError: boolean
  /** Every content item the tool sent; a listing sends one per row and none for no match. */
  texts: string[]
  rows: Record<string, any>[]
}

/** Call a listing tool on the MCP endpoint and keep every row it sends. */
export function listRows(tool: string, args: Record<string, unknown> = {}): McpRows {
  const answer = callToolItems(MCP_PORT, tool, args)
  const rows = answer.isError ? [] : answer.texts.map((text) => JSON.parse(text) as Record<string, any>)
  return { isError: answer.isError, texts: answer.texts, rows }
}

const MEMBER_FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
) as Record<string, unknown>

async function okData(resp: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<any> {
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `${what} failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body?.data ?? body
}

/** Seed a one-Block Test under the exact name and check it validates clean. */
export async function seedTest(request: APIRequestContext, name: string): Promise<string> {
  const created = await okData(
    await request.post(`${BACKEND_URL}/tests`, { data: { ...MEMBER_FIXTURE, name } }),
    `POST /tests ${name}`,
  )
  const testId = String(created.id)
  const validated = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const body = await validated.json().catch(() => null)
  expect(validated.ok(), `POST /tests/${testId}/validate failed: ${validated.status()}`).toBeTruthy()
  const errors = body?.data?.errors ?? body?.error?.details?.[0]?.errors ?? body?.errors ?? []
  expect(errors, `${name} must validate with no errors`).toEqual([])
  return testId
}

export interface MemberEntity {
  name: string
  description?: string
  tags?: string[]
  variables?: Record<string, unknown>
  tests?: string[]
  suites?: string[]
}

/** Seed a Suite or a Regression through the backend API; returns its id. */
export async function seedEntity(
  request: APIRequestContext,
  route: '/suites' | '/regressions',
  entity: MemberEntity,
): Promise<string> {
  const created = await okData(await request.post(`${BACKEND_URL}${route}`, { data: entity }), `POST ${route}`)
  return String(created.id)
}

/** The `data` of a backend `GET`. */
export async function readApi(request: APIRequestContext, apiPath: string): Promise<any> {
  return okData(await request.get(`${BACKEND_URL}${apiPath}`), `GET ${apiPath}`)
}

/** The stored entity as `GET <route>/<id>` shows it. */
export async function readEntity(
  request: APIRequestContext,
  route: EntityRoute,
  id: string,
): Promise<Record<string, any>> {
  return readApi(request, `${route}/${id}`)
}

/** Every row the list route holds for a search, page by page. */
export async function listViaApi(
  request: APIRequestContext,
  route: EntityRoute,
  search = '',
): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = []
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ per_page: '100', page: String(page) })
    if (search) query.set('search', search)
    const resp = await request.get(`${BACKEND_URL}${route}?${query.toString()}`)
    const body = await resp.json().catch(() => null)
    expect(resp.ok(), `GET ${route} failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
    rows.push(...((body?.data ?? []) as Record<string, any>[]))
    if (page >= Number(body?.pagination?.total_pages ?? 1)) return rows
  }
}

/** The ids of the stored entities named exactly `name`. */
export async function idsNamed(request: APIRequestContext, route: EntityRoute, name: string): Promise<string[]> {
  const rows = await listViaApi(request, route, name)
  return rows.filter((row) => row.name === name).map((row) => String(row.id))
}

/** Delete every Regression, Suite and Test whose name starts with the prefix. */
export async function sweep(request: APIRequestContext, prefix: string): Promise<void> {
  for (const route of ['/regressions', '/suites', '/tests'] as const) {
    const rows = await listViaApi(request, route, prefix)
    for (const row of rows.filter((entry) => String(entry.name).startsWith(prefix))) {
      await request.delete(`${BACKEND_URL}${route}/${row.id}`).catch(() => undefined)
    }
  }
}

/** The stored variables with the shared variables reveal on, so a secret shows the value it holds. */
export async function revealedVariables(
  request: APIRequestContext,
  route: '/suites' | '/regressions',
  id: string,
): Promise<Record<string, any>> {
  await setMasking(request, { shared_variables: true })
  try {
    return (await readEntity(request, route, id)).variables as Record<string, any>
  } finally {
    await setMasking(request, { shared_variables: false })
  }
}

/** The secret value the seeded and created entities hold. */
export const TOKEN = 'zz-mcp-token-7f3a91'

/** Typed variables with one secret, as a client writes them. */
export const VARIABLES = {
  region: { type: 'string', value: 'eu-west' },
  retries: { type: 'integer', value: 3 },
  api_token: { type: 'string', value: TOKEN, secret: true },
}

/** The same variables as every read shows them. */
export const MASKED_VARIABLES = {
  region: { type: 'string', value: 'eu-west' },
  retries: { type: 'integer', value: 3 },
  api_token: { type: 'string', value: MASK, secret: true },
}
