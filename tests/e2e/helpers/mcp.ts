/** MCP helpers for specs: the reset payload, a live listener, endpoint probes, one-shot tool calls and a held client session. */

import { execFileSync, spawn } from 'child_process'
import path from 'path'
import { expect, type Page } from './playwright-fixtures'
import { BACKEND_URL } from './config'
import { BACKEND_DIR } from './spawn-backend'

export const MCP_DEFAULTS = {
  enabled: false,
  until_restart: false,
  port: 8765,
  bind: 'local',
  auth_enabled: false,
  auth_username: '',
  // An empty password clears a stored one.
  auth_password: '',
}

/** Reset MCP settings to defaults (listener stopped, both enablement modes off, no password). */
export async function resetMcpSettings(page: Page): Promise<void> {
  await page.request.put(`${BACKEND_URL}/mcp/settings`, { data: MCP_DEFAULTS })
}

/** Enable the listener until-restart on the given port; returns the endpoint URL. */
export async function enableMcpUntilRestart(page: Page, port: number): Promise<string> {
  const resp = await page.request.put(`${BACKEND_URL}/mcp/settings`, {
    data: { ...MCP_DEFAULTS, until_restart: true, port },
  })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `PUT /mcp/settings failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()

  let url = ''
  await expect
    .poll(
      async () => {
        const status = await (await page.request.get(`${BACKEND_URL}/mcp/status`)).json()
        url = status?.urls?.[0] ?? ''
        return Boolean(status?.running && url)
      },
      { timeout: 15_000, message: 'expected the MCP listener to reach Running' },
    )
    .toBeTruthy()
  return url
}

// ============================================================================
// Endpoint probes
// ============================================================================

const MCP_PROTOCOL_VERSION = '2025-06-18'
const MCP_SESSION_HEADER = 'mcp-session-id'
const MCP_VERSION_HEADER = 'mcp-protocol-version'
const JSON_RPC_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

export interface McpCredentials {
  username: string
  password: string
}

export interface McpEndpointAnswer {
  status: number
  /** `serverInfo.name` of an answered `initialize`. */
  serverName?: string
  /** The `WWW-Authenticate` header of a refused request. */
  wwwAuthenticate?: string
}

export interface McpSessionAnswer {
  status: number
  /** The `error` text of a refused request. */
  error?: string
}

/** The loopback address of the MCP endpoint on `port`. */
export function mcpEndpointUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

function authorization(credentials?: McpCredentials): Record<string, string> {
  if (!credentials) return {}
  const pair = `${credentials.username}:${credentials.password}`
  return { authorization: `Basic ${Buffer.from(pair).toString('base64')}` }
}

function isConnectionRefused(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause
  return cause?.code === 'ECONNREFUSED'
}

/** The JSON-RPC message of an answer sent as JSON or as one server-sent event. */
function jsonRpcMessage(body: string): Record<string, any> | undefined {
  const event = body.split('\n').find((line) => line.startsWith('data: '))
  try {
    return JSON.parse(event ? event.slice('data: '.length) : body)
  } catch {
    return undefined
  }
}

/** Send one MCP `initialize` to the endpoint on `port`; undefined when nothing listens there. */
export async function askMcpEndpoint(
  port: number,
  credentials?: McpCredentials,
): Promise<McpEndpointAnswer | undefined> {
  const url = mcpEndpointUrl(port)
  const auth = authorization(credentials)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_RPC_HEADERS, ...auth },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'wave-e2e-probe', version: '1.0.0' },
        },
      }),
    })
  } catch (error) {
    if (isConnectionRefused(error)) return undefined
    throw error
  }
  const message = jsonRpcMessage(await response.text())
  const sessionId = response.headers.get(MCP_SESSION_HEADER)
  if (sessionId) {
    // The probe ends its own session, so the Sessions list holds only real clients.
    await fetch(url, {
      method: 'DELETE',
      headers: { ...auth, [MCP_SESSION_HEADER]: sessionId, [MCP_VERSION_HEADER]: MCP_PROTOCOL_VERSION },
    }).catch(() => undefined)
  }
  return {
    status: response.status,
    serverName: message?.result?.serverInfo?.name,
    wwwAuthenticate: response.headers.get('www-authenticate') ?? undefined,
  }
}

/** Send one `tools/list` inside an existing session of the endpoint on `port`. */
export async function askMcpSession(port: number, sessionId: string): Promise<McpSessionAnswer> {
  const response = await fetch(mcpEndpointUrl(port), {
    method: 'POST',
    headers: {
      ...JSON_RPC_HEADERS,
      [MCP_SESSION_HEADER]: sessionId,
      [MCP_VERSION_HEADER]: MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  })
  const message = jsonRpcMessage(await response.text())
  const error = typeof message?.error === 'string' ? message.error : undefined
  return { status: response.status, error }
}

// ============================================================================
// One-shot tool calls
// ============================================================================

const TOOL_CLIENT_PATH = path.resolve(__dirname, '../functional/recipe-authoring/mcp_tool_client.py')

export interface McpToolResult {
  isError: boolean
  payload: Record<string, any>
}

/** Call one MCP tool on the endpoint at `port` through the one-shot SDK client; returns its envelope. */
export function callTool(port: number, tool: string, args: Record<string, unknown>): McpToolResult {
  const stdout = execFileSync('poetry', ['run', 'python', TOOL_CLIENT_PATH, mcpEndpointUrl(port), tool], {
    cwd: BACKEND_DIR,
    input: JSON.stringify(args),
    timeout: 90_000,
    encoding: 'utf-8',
  })
  return JSON.parse(stdout.trim().split('\n').pop() ?? '') as McpToolResult
}

// ============================================================================
// Held client session
// ============================================================================

const CLIENT_CONNECT_TIMEOUT_MS = 60_000
const CLIENT_EXIT_GRACE_MS = 10_000

// The SDK client the one-shot E2E clients use, kept connected until its input ends.
const HELD_CLIENT_PROGRAM = [
  'import asyncio, sys',
  'from mcp import types',
  'from mcp.client import Client',
  '',
  'async def main():',
  '    info = types.Implementation(name=sys.argv[2], version="1.0.0")',
  '    async with Client(sys.argv[1], client_info=info) as client:',
  '        await client.list_tools()',
  '        print("connected", flush=True)',
  '        await asyncio.get_running_loop().run_in_executor(None, sys.stdin.read)',
  '',
  'asyncio.run(main())',
].join('\n')

export interface McpClientSession {
  /** The session id the endpoint gave this client. */
  sessionId: string
  /** Ends the client process. */
  close(): Promise<void>
}

/** Connect one MCP client named `clientName` to `url` and keep its session open until `close()`. */
export async function connectMcpClient(
  page: Page,
  url: string,
  clientName: string,
): Promise<McpClientSession> {
  const child = spawn('poetry', ['run', 'python', '-c', HELD_CLIENT_PROGRAM, url, clientName], {
    cwd: BACKEND_DIR,
  })
  let output = ''
  let running = true
  const exited = new Promise<void>((resolve) => {
    const ended = (): void => {
      running = false
      resolve()
    }
    child.once('close', ended)
    child.once('error', ended)
  })
  // A client that already exited has no input left to end.
  child.stdin.on('error', () => undefined)

  const close = async (): Promise<void> => {
    if (!running) return
    const timer = setTimeout(() => child.kill('SIGKILL'), CLIENT_EXIT_GRACE_MS)
    child.stdin.end()
    await exited
    clearTimeout(timer)
  }

  const connected = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MCP client did not connect to ${url}: ${output}`)),
      CLIENT_CONNECT_TIMEOUT_MS,
    )
    const settle = (action: () => void): void => {
      clearTimeout(timer)
      action()
    }
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('connected')) settle(resolve)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    child.once('error', (error) => settle(() => reject(error)))
    child.once('close', (code) =>
      settle(() => reject(new Error(`MCP client exited with code ${code}: ${output}`))),
    )
  })

  let sessionId = ''
  try {
    await connected
    await expect
      .poll(
        async () => {
          const status = await (await page.request.get(`${BACKEND_URL}/mcp/status`)).json()
          const sessions = (status?.sessions ?? []) as { session_id: string; client: string }[]
          sessionId = sessions.find((session) => session.client === clientName)?.session_id ?? ''
          return sessionId
        },
        { timeout: 15_000, message: `expected a session of ${clientName} in GET /mcp/status` },
      )
      .not.toBe('')
  } catch (error) {
    await close()
    throw error
  }
  return { sessionId, close }
}
