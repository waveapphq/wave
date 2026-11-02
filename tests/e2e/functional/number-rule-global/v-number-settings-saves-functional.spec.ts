/**
 * V-NUMBER-SETTINGS-SAVES: Settings writes and the config file read a port, a level and a count by the one number rule
 * Wireframe: N/A (API and start-up behavior; no UI of its own)
 * Design Decisions: SETTINGS-18, SETTINGS-21, MCP-4, NET-1, NET-4
 * REQ: REQ-3.1.3.14, REQ-4.7.15, REQ-4.7.20
 *
 * Each write goes to the stack's own API and is read back; every setting changed is put back. The
 * config-file start checks run a second WAVE backend on a config file of its own.
 *
 * Pass Criteria:
 * 1. MCP Server: a port sent as `+8765` is refused 400 `Port must be an integer between 1024 and 65535`
 *    and the stored port stays; a port sent as the digits `8766` is stored as the number 8766.
 * 2. Proxy: a Custom port sent as `3128.0` is refused 400 `Port must be a whole number from 1 to 65535`
 *    and nothing is stored; a port sent as the digits `3128` is stored as the number 3128.
 * 3. Create backup with compression level 5.5 answers 400 `Compression level must be between 1 and 9`.
 * 4. SSH Hosts: an addition with port 22.5, and one with port true, is refused 400
 *    `Addition 1: port must be from 1 to 65535` and no host is added.
 * 5. Periodic Backup: a Max Backups to Keep of 20 digits is refused 400
 *    `Max backups allows at most 19 digits` and the schedule stays as it was.
 * 6. A config file with `mcp.port: 0x223D` stops WAVE at start with
 *    `Config file <file>: mcp.port must be a whole number from 1024 to 65535`.
 * 7. A config file with `mcp.port: '8765'` (and the endpoint on) starts WAVE: the MCP settings read the
 *    number 8765, an MCP initialize on 8765 is answered by WAVE, and the port refuses once WAVE stops.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, HTTP_TARGET_HOST } from '../../helpers/config'
import { askMcpEndpoint, MCP_DEFAULTS, resetMcpSettings } from '../../helpers/mcp'
import { resetNetworkSettings, SSH_HOST_KEY } from '../../helpers/network-settings'
import { refusalOf } from '../../helpers/number-entry'
import {
  EXAMPLE_CONFIG_TEXT,
  removeSpawnedBackends,
  spawnBackend,
  type SpawnedBackend,
} from '../../helpers/spawn-backend'

const MCP_PORT_REFUSAL = 'Port must be an integer between 1024 and 65535'
const PROXY_PORT_REFUSAL = 'Port must be a whole number from 1 to 65535'
const LEVEL_REFUSAL = 'Compression level must be between 1 and 9'
const ADDITION_REFUSAL = 'Addition 1: port must be from 1 to 65535'
const COUNT_REFUSAL = 'Max backups allows at most 19 digits'
const MCP_FILE_PORT = 8765
const ANSWERED_BY_WAVE = '200 WAVE'
const REFUSED = 'refused'
const NEW_HOST = 'zz-11541-s9-host.invalid'

const EXAMPLE_MCP = 'mcp:\n  enabled: false\n  port: 8765\n'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One whole ERROR log line; a line written while a request is served carries the request's short id. */
function errorLine(message: string): RegExp {
  return new RegExp(
    `^\\d{2}:\\d{2}:\\d{2}\\.\\d{3} ERROR (?:\\[[0-9a-f]{8}\\] )?${escapeRegExp(message)}$`,
    'm',
  )
}

async function json(page: Page, path: string): Promise<Record<string, any>> {
  const response = await page.request.get(`${BACKEND_URL}${path}`)
  expect(response.ok(), `GET ${path} answered ${response.status()}`).toBeTruthy()
  return (await response.json()) as Record<string, any>
}

/** What one MCP initialize sent to `port` meets: status and server name, or `refused`. */
async function probe(port: number): Promise<string> {
  const answer = await askMcpEndpoint(port)
  if (!answer) return REFUSED
  return [answer.status, answer.serverName].filter(Boolean).join(' ')
}

test.describe('V-NUMBER-SETTINGS-SAVES: Settings writes and the config file', () => {
  test.describe.configure({ mode: 'serial' })

  test.afterEach(async () => {
    await removeSpawnedBackends()
  })

  test('MCP Server: +8765 is refused with the port message, the digits 8766 are stored as the number', async ({
    page,
  }) => {
    await resetMcpSettings(page)
    try {
      await test.step('1. +8765 is refused and the stored port stays', async () => {
        const refusal = await refusalOf(
          await page.request.put(`${BACKEND_URL}/mcp/settings`, { data: { ...MCP_DEFAULTS, port: '+8765' } }),
          'PUT /mcp/settings with port +8765',
        )
        expect(refusal.status).toBe(400)
        expect(refusal.message).toBe(MCP_PORT_REFUSAL)
        expect((await json(page, '/mcp/settings')).port).toBe(MCP_DEFAULTS.port)
      })

      await test.step('1. the digits 8766 are stored as the number 8766', async () => {
        const response = await page.request.put(`${BACKEND_URL}/mcp/settings`, {
          data: { ...MCP_DEFAULTS, port: '8766' },
        })
        expect(response.ok(), `PUT /mcp/settings answered ${await response.text()}`).toBeTruthy()
        expect((await json(page, '/mcp/settings')).port).toBe(8766)
      })
    } finally {
      await resetMcpSettings(page)
    }
  })

  test('Proxy: 3128.0 is refused with the port message, the digits 3128 are stored as the number', async ({
    page,
  }) => {
    await resetNetworkSettings(BACKEND_URL)
    const custom = { enabled: true, source: 'custom', host: HTTP_TARGET_HOST }
    try {
      await test.step('2. 3128.0 is refused and nothing is stored', async () => {
        const before = await json(page, '/network/proxy')
        const refusal = await refusalOf(
          await page.request.patch(`${BACKEND_URL}/network/proxy`, { data: { ...custom, port: '3128.0' } }),
          'PATCH /network/proxy with port 3128.0',
        )
        expect(refusal.status).toBe(400)
        expect(refusal.message).toBe(PROXY_PORT_REFUSAL)
        expect(await json(page, '/network/proxy')).toEqual(before)
      })

      await test.step('2. the digits 3128 are stored as the number 3128', async () => {
        const response = await page.request.patch(`${BACKEND_URL}/network/proxy`, { data: { ...custom, port: '3128' } })
        expect(response.ok(), `PATCH /network/proxy answered ${await response.text()}`).toBeTruthy()
        const saved = await json(page, '/network/proxy')
        expect(saved.port).toBe(3128)
        expect(saved.enabled).toBe(true)
      })
    } finally {
      await resetNetworkSettings(BACKEND_URL)
    }
  })

  test('Create backup with compression level 5.5 is refused with the level message', async ({ page }) => {
    const refusal = await refusalOf(
      await page.request.post(`${BACKEND_URL}/api/backup/create`, {
        data: { entity_types: ['tests'], format: 'yaml', compression_method: 'deflate', compression_level: 5.5 },
      }),
      'POST /api/backup/create with level 5.5',
    )
    expect(refusal.status).toBe(400)
    expect(refusal.message).toBe(LEVEL_REFUSAL)
  })

  test('SSH Hosts: an addition with port 22.5 or true is refused and nothing is added', async ({ page }) => {
    const before = await json(page, '/network/ssh-hosts')
    for (const port of [22.5, true]) {
      await test.step(`4. port ${String(port)} is refused`, async () => {
        const refusal = await refusalOf(
          await page.request.patch(`${BACKEND_URL}/network/ssh-hosts`, {
            data: { add: [{ host: NEW_HOST, port, key_type: 'ED25519', key: SSH_HOST_KEY }] },
          }),
          `PATCH /network/ssh-hosts with port ${String(port)}`,
        )
        expect(refusal.status).toBe(400)
        expect(refusal.message).toBe(ADDITION_REFUSAL)
      })
    }
    expect(await json(page, '/network/ssh-hosts'), 'no host was added').toEqual(before)
  })

  test('Periodic Backup: a Max Backups to Keep of 20 digits is refused with the digit cap', async ({ page }) => {
    const before = (await json(page, '/api/backup/schedule')).data
    const refusal = await refusalOf(
      await page.request.put(`${BACKEND_URL}/api/backup/schedule`, {
        data: { enabled: true, cron: '0 3 1 1 *', max_backups: '12345678901234567890' },
      }),
      'PUT /api/backup/schedule with 20 digits',
    )
    expect(refusal.status).toBe(400)
    expect(refusal.message).toBe(COUNT_REFUSAL)
    expect((await json(page, '/api/backup/schedule')).data, 'the schedule stays as it was').toEqual(before)
  })

  test('a config file with mcp.port 0x223D stops WAVE at start with the mcp.port rule', async () => {
    test.setTimeout(120_000)
    const configText = EXAMPLE_CONFIG_TEXT.replace(EXAMPLE_MCP, 'mcp:\n  enabled: false\n  port: 0x223D\n')
    expect(configText).toMatch(/^ {2}port: 0x223D$/m)
    const backend = await spawnBackend({ configText })

    expect(backend.exitCode, `the backend should have exited:\n${backend.output()}`).toBe(1)
    expect(backend.output()).toMatch(
      errorLine(`Config file ${backend.configFile}: mcp.port must be a whole number from 1024 to 65535`),
    )
  })

  test("a config file with mcp.port '8765' starts WAVE listening on 8765", async ({ page }) => {
    test.setTimeout(180_000)
    await resetMcpSettings(page)
    expect(await probe(MCP_FILE_PORT), 'nothing listens on 8765 before the second backend starts').toBe(REFUSED)
    const configText = EXAMPLE_CONFIG_TEXT.replace(EXAMPLE_MCP, "mcp:\n  enabled: true\n  port: '8765'\n")
    expect(configText).toMatch(/^ {2}port: '8765'$/m)
    let backend: SpawnedBackend | undefined
    try {
      backend = await spawnBackend({ configText })
      expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()

      await test.step('7. the MCP settings read the number 8765 and the endpoint runs', async () => {
        const settings = await page.request.get(`${backend!.baseUrl}/mcp/settings`)
        expect(settings.ok()).toBeTruthy()
        expect(await settings.json()).toMatchObject({ enabled: true, port: MCP_FILE_PORT })
        await expect
          .poll(async () => (await (await page.request.get(`${backend!.baseUrl}/mcp/status`)).json()).running, {
            message: 'the endpoint reaches Running',
            timeout: 15_000,
          })
          .toBe(true)
      })

      await test.step('7. an MCP initialize on 8765 is answered by WAVE', async () => {
        await expect.poll(() => probe(MCP_FILE_PORT), { timeout: 15_000 }).toBe(ANSWERED_BY_WAVE)
      })

      await backend.stop()
      await test.step('7. the port refuses once WAVE stops', async () => {
        await expect.poll(() => probe(MCP_FILE_PORT), { timeout: 15_000 }).toBe(REFUSED)
      })
    } finally {
      await backend?.stop()
    }
  })
})
