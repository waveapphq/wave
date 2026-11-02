/**
 * V-INSTANCE-CONFIG-STARTUP: WAVE starts from one config file and keeps its settings in it
 * Wireframe: none (no page is opened; every step runs against a backend the test starts)
 * Design Decisions: none (startup and config file behavior)
 * REQ: REQ-4.7.13, REQ-4.7.15, REQ-4.7.17, REQ-4.7.18, REQ-4.7.20, REQ-4.5.14, REQ-4.5.16,
 *   REQ-5.2.7.1, REQ-4.5.1
 *
 * Each test starts its own backend (`helpers/spawn-backend.ts`) on a free port, with a config
 * file and a data folder in a new folder under the temp folder. The stack's backend, config
 * file and data folder are never used. A refused start is proven by exit code 1 and the ERROR
 * line in the output; a setting by its route's answer and by the config file's own text.
 *
 * Pass Criteria:
 * 1. STARTUP-1: `WAVE_CONFIG_FILE` names a file that does not exist: exit 1 and exactly
 *    `Config file not found: {path} (set WAVE_CONFIG_FILE to use another file)`.
 * 2. STARTUP-2: a relative `WAVE_CONFIG_FILE`: exit 1 and exactly
 *    `WAVE_CONFIG_FILE must be an absolute path: {value}`.
 * 3. STARTUP-2b: a file holding a YAML list: exit 1 and exactly
 *    `Config file {path} does not hold a YAML mapping`.
 * 4. STARTUP-2c: a file that does not parse: exit 1 and `Config file {path} cannot be read: `
 *    followed by the parser's reason.
 * 5. STARTUP-3: `mcp.port: 80`: exit 1 and exactly
 *    `Config file {path}: mcp.port must be a whole number from 1024 to 65535`.
 * 6. STARTUP-4: `mcp.auth_password: plain`: exit 1 and exactly `Config file {path}:
 *    mcp.auth_password must be set from Settings > MCP Server, where it is stored sealed`.
 * 7. STARTUP-5: `WAVE_LOG_LEVEL=verbose`: exit 1 and exactly
 *    `WAVE_LOG_LEVEL must be one of DEBUG, INFO, WARN, ERROR, FATAL: verbose`.
 * 8. STARTUP-6: the example with a throwaway key starts: `/health` answers 200, the log holds
 *    `Config file: {path}` before `Data folder: {path}`, `GET /server/status` names both, the
 *    data folder exists and the file is unchanged.
 * 9. STARTUP-7: `WAVE_ENV=production` changes nothing: the backend starts on the named file
 *    with the file's log level.
 * 10. STARTUP-8: log level DEBUG, `run_output` revealed, MCP port 8799 with authentication and
 *     a password, a schedule turned on with a cron and a save folder, SSH default Strict and
 *     certificate source `host` (the file starts on `builtin`) are saved, each a value other
 *     than its default; the file holds each one, `public_source: host` under
 *     `network.certificates`; after a stop and a start on the same file every value reads
 *     back, `auth_password_set` is true, the file holds a `wave:enc:` value and never the
 *     password. The restarted backend logs `Periodic backup scheduler task created` and
 *     `Next periodic backup at {next run} (in {n} seconds)`.
 * 11. STARTUP-9: file level INFO with `WAVE_LOG_LEVEL=WARN`: the level in force is WARN; saving
 *     DEBUG puts DEBUG in force at once and in the file; a restart with the same variable is
 *     at WARN again while the file still holds DEBUG.
 * 12. STARTUP-10: on the example with a throwaway key, and on a file without the `network` and
 *     `backup` sections, the schedule answers every backup entity type in sorted order and the
 *     save folder `~/wave-backups`, and the SSH policy answers default block action `disabled`.
 * 13. STARTUP-11: a file with unknown keys inside `mcp` and `network.ssh_hosts` and an unknown
 *     top-level section starts; after a saved log level the file differs by that one line.
 * 14. STARTUP-12: with a schedule turned on, turning it off logs
 *     `Periodic backup scheduler stopped` and `No active periodic backup schedule`, and the
 *     schedule answers off with an empty cron and no next run.
 * 15. STARTUP-13: no secret encryption key (no `secret_key` line in `security`, no
 *     `WAVE_SECRET_KEY`): exit 1 and exactly `No secret encryption key configured: make one with
 *     'poetry run wave-new-secret-key' in the backend folder, then set it as security.secret_key
 *     in the config file or as the WAVE_SECRET_KEY environment variable`.
 * 16. STARTUP-13b: the example exactly as shipped (its `security.secret_key` is empty), no
 *     `WAVE_SECRET_KEY`: exit 1 and exactly the same message.
 * 17. STARTUP-14: a key that is not 32 bytes of base64 (text that is not base64, then 16 bytes of
 *     base64): exit 1 and exactly `Secret encryption key must be a base64-encoded 32-byte value.
 *     Check WAVE_SECRET_KEY / security.secret_key.`
 * 18. STARTUP-15: another 32-byte key on a data folder that holds the key sentinel: exit 1 and
 *     an ERROR line holding `does not decrypt existing sealed data`.
 * 19. STARTUP-16: no data folder set (no `storage` section, no `WAVE_STORAGE_BASE_PATH`): exit 1
 *     and exactly `Data folder not set: add storage.base_path to the config file or set
 *     WAVE_STORAGE_BASE_PATH`; no data folder is made.
 * 20. STARTUP-17: `WAVE_STORAGE_BASE_PATH=data`: exit 1 and exactly
 *     `WAVE_STORAGE_BASE_PATH must be an absolute path: data`.
 * 21. STARTUP-18: a data folder under a plain file: exit 1 and
 *     `Data folder {path} cannot be created: ` followed by the system's reason.
 */

import { randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSection, readConfigText } from '../../helpers/config-file'
import {
  EXAMPLE_CONFIG_TEXT,
  removeSpawnedBackends,
  SHIPPED_EXAMPLE_CONFIG_TEXT,
  spawnBackend,
  type SpawnedBackend,
} from '../../helpers/spawn-backend'

type Json = Record<string, unknown>

const BACKUP_ENTITY_TYPES = [
  'certificates',
  'environments',
  'functions',
  'profiles',
  'regressions',
  'ssh_hosts',
  'suites',
  'system_variables',
  'tests',
]

/** A schedule that is on and never due while a test runs. */
const YEARLY_CRON = '0 3 1 1 *'

const MCP_USERNAME = 'e2e-startup-admin'
const MCP_PASSWORD = 'Startup-Plain-Pass-7431'

const NO_KEY_REFUSAL =
  "No secret encryption key configured: make one with 'poetry run wave-new-secret-key' in the backend folder, then set it as security.secret_key in the config file or as the WAVE_SECRET_KEY environment variable"

const UNKNOWN_SECTION = [
  '',
  'e2e_unknown_section:',
  '  # a comment WAVE does not own',
  '  note: kept',
  '  items:',
  '    - one',
  '    - two',
  '',
].join('\n')

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One whole log line; a line written while a request is served carries the request's short id. */
function logLine(level: 'INFO' | 'ERROR', message: string | RegExp): RegExp {
  const body = typeof message === 'string' ? escapeRegExp(message) : message.source
  return new RegExp(
    `^\\d{2}:\\d{2}:\\d{2}\\.\\d{3} ${level.padEnd(5)} (?:\\[[0-9a-f]{8}\\] )?${body}$`,
    'm'
  )
}

function expectRefusal(backend: SpawnedBackend, message: string | RegExp): void {
  expect(backend.exitCode, `the backend should have exited:\n${backend.output()}`).toBe(1)
  expect(backend.output()).toMatch(logLine('ERROR', message))
}

function expectRunning(backend: SpawnedBackend): void {
  expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()
}

async function read(request: APIRequestContext, url: string): Promise<Json> {
  const response = await request.get(url)
  expect(response.ok(), `GET ${url} failed: ${response.status()}`).toBeTruthy()
  return (await response.json()) as Json
}

async function save(
  request: APIRequestContext,
  method: 'put' | 'patch',
  url: string,
  data: Json
): Promise<Json> {
  const response = await request[method](url, { data })
  expect(
    response.ok(),
    `${method.toUpperCase()} ${url} failed: ${response.status()} ${await response.text()}`
  ).toBeTruthy()
  return (await response.json()) as Json
}

async function schedule(request: APIRequestContext, backend: SpawnedBackend): Promise<Json> {
  return (await read(request, `${backend.baseUrl}/api/backup/schedule`)).data as Json
}

/** A folder beside the data folder, inside the backend's own temp folder. */
function backupFolder(backend: SpawnedBackend): string {
  return path.join(path.dirname(backend.dataDir), 'backups')
}

/** The `public_source` line as it sits under `certificates:` in the network section. */
function certificateSourceLine(source: 'builtin' | 'host'): RegExp {
  return new RegExp(`^  certificates:\\n(?:    .*\\n)*?    public_source: ${source}$`, 'm')
}

/** The config text without the named top-level sections. */
function withoutSections(text: string, names: string[]): string {
  let dropping = false
  return text
    .split('\n')
    .filter((line) => {
      if (/^[^\s#]/.test(line)) dropping = names.some((name) => line.startsWith(`${name}:`))
      return !dropping
    })
    .join('\n')
}

test.describe('V-INSTANCE-CONFIG-STARTUP: WAVE starts from one config file and keeps its settings in it', () => {
  test.afterEach(async () => {
    await removeSpawnedBackends()
  })

  test('STARTUP-1: a config file that does not exist stops the start', async () => {
    const backend = await spawnBackend({ configText: null })

    expect(fs.existsSync(backend.configFile)).toBe(false)
    expectRefusal(
      backend,
      `Config file not found: ${backend.configFile} (set WAVE_CONFIG_FILE to use another file)`
    )
  })

  test('STARTUP-2: a relative WAVE_CONFIG_FILE stops the start', async () => {
    const relative = 'wave-e2e-relative/config.yaml'
    const backend = await spawnBackend({ env: { WAVE_CONFIG_FILE: relative } })

    expectRefusal(backend, `WAVE_CONFIG_FILE must be an absolute path: ${relative}`)
  })

  test('STARTUP-2b: a config file holding a YAML list stops the start', async () => {
    const backend = await spawnBackend({ configText: '- one\n- two\n' })

    expectRefusal(backend, `Config file ${backend.configFile} does not hold a YAML mapping`)
  })

  test('STARTUP-2c: a config file that does not parse stops the start', async () => {
    const backend = await spawnBackend({ configText: 'logging:\n  level: [INFO\n' })

    // The reason is the parser's own wording.
    const prefix = escapeRegExp(`Config file ${backend.configFile} cannot be read: `)
    expectRefusal(backend, new RegExp(`${prefix}\\S.*`))
  })

  test('STARTUP-3: mcp.port 80 stops the start', async () => {
    const configText = EXAMPLE_CONFIG_TEXT.replace('\n  port: 8765\n', '\n  port: 80\n')
    expect(configText).toMatch(/^  port: 80$/m)
    const backend = await spawnBackend({ configText })

    expectRefusal(
      backend,
      `Config file ${backend.configFile}: mcp.port must be a whole number from 1024 to 65535`
    )
  })

  test('STARTUP-4: a plain mcp.auth_password stops the start', async () => {
    const configText = EXAMPLE_CONFIG_TEXT.replace('auth_password: null', 'auth_password: plain')
    expect(configText).toMatch(/^  auth_password: plain$/m)
    const backend = await spawnBackend({ configText })

    expectRefusal(
      backend,
      `Config file ${backend.configFile}: mcp.auth_password must be set from Settings > MCP Server, where it is stored sealed`
    )
  })

  test('STARTUP-5: an unknown WAVE_LOG_LEVEL stops the start', async () => {
    const backend = await spawnBackend({ env: { WAVE_LOG_LEVEL: 'verbose' } })

    expectRefusal(
      backend,
      'WAVE_LOG_LEVEL must be one of DEBUG, INFO, WARN, ERROR, FATAL: verbose'
    )
  })

  test('STARTUP-6: the example with a throwaway key starts and the log names the config file before the data folder', async ({
    request,
  }) => {
    const backend = await spawnBackend()

    expectRunning(backend)
    expect((await request.get(`${backend.baseUrl}/health`)).status()).toBe(200)

    const configLine = logLine('INFO', `Config file: ${backend.configFile}`)
    const dataLine = logLine('INFO', `Data folder: ${backend.dataDir}`)
    await expect.poll(() => backend.output()).toMatch(dataLine)
    const output = backend.output()
    expect(output).toMatch(configLine)
    expect(output.search(configLine)).toBeLessThan(output.search(dataLine))

    expect(await read(request, `${backend.baseUrl}/server/status`)).toMatchObject({
      config_file: backend.configFile,
      data_folder: backend.dataDir,
    })
    expect(fs.statSync(backend.dataDir).isDirectory()).toBe(true)
    expect(readConfigText(backend.configFile)).toBe(EXAMPLE_CONFIG_TEXT)
  })

  test('STARTUP-7: WAVE_ENV is ignored and the named config file is the one in use', async ({
    request,
  }) => {
    const backend = await spawnBackend({ env: { WAVE_ENV: 'production' } })

    expectRunning(backend)
    expect((await request.get(`${backend.baseUrl}/health`)).status()).toBe(200)
    expect(await read(request, `${backend.baseUrl}/server/status`)).toMatchObject({
      config_file: backend.configFile,
      data_folder: backend.dataDir,
    })
    expect(configSection(backend.configFile, 'logging')).toMatch(/^  level: INFO$/m)
    expect((await read(request, `${backend.baseUrl}/admin/log-level`)).level).toBe('INFO')
  })

  test('STARTUP-8: every saved setting reads back after a restart and the MCP password stays sealed', async ({
    request,
  }) => {
    const first = await spawnBackend()
    expectRunning(first)
    const file = first.configFile
    const backups = backupFolder(first)

    function expectFileHoldsSavedValues(): void {
      expect(configSection(file, 'logging')).toMatch(/^  level: DEBUG$/m)
      expect(configSection(file, 'secret_masking')).toMatch(/^  run_output: true$/m)
      const mcp = configSection(file, 'mcp')
      expect(mcp).toMatch(/^  port: 8799$/m)
      expect(mcp).toMatch(/^  auth_enabled: true$/m)
      expect(mcp).toMatch(new RegExp(`^  auth_username: "?${MCP_USERNAME}"?$`, 'm'))
      expect(mcp).toMatch(/^  auth_password: "?wave:enc:v1:[A-Za-z0-9+/=]+"?$/m)
      expect(readConfigText(file)).not.toContain(MCP_PASSWORD)
      const backup = configSection(file, 'backup')
      expect(backup).toMatch(/^    enabled: true$/m)
      expect(backup).toMatch(new RegExp(`^    cron: "?${escapeRegExp(YEARLY_CRON)}"?$`, 'm'))
      expect(backup).toMatch(new RegExp(`^    save_directory: "?${escapeRegExp(backups)}"?$`, 'm'))
      const network = configSection(file, 'network')
      expect(network).toMatch(/^    default_block_action: strict$/m)
      expect(network).toMatch(certificateSourceLine('host'))
    }

    await test.step('the file starts on the built-in certificate source', async () => {
      expect(configSection(file, 'network')).toMatch(certificateSourceLine('builtin'))
    })

    await test.step('each setting is saved through its own route', async () => {
      await save(request, 'put', `${first.baseUrl}/admin/log-level`, { level: 'DEBUG' })
      await save(request, 'put', `${first.baseUrl}/admin/secret-masking`, { run_output: true })
      await save(request, 'put', `${first.baseUrl}/mcp/settings`, {
        port: 8799,
        auth_enabled: true,
        auth_username: MCP_USERNAME,
        auth_password: MCP_PASSWORD,
      })
      await save(request, 'put', `${first.baseUrl}/api/backup/schedule`, {
        enabled: true,
        cron: YEARLY_CRON,
        save_directory: backups,
      })
      await save(request, 'patch', `${first.baseUrl}/network/ssh-hosts`, {
        policy: { default_block_action: 'strict' },
      })
      const certificates = await save(request, 'patch', `${first.baseUrl}/network/certificates`, {
        public_source: 'host',
      })
      expect((certificates.settings as Json).public_source).toBe('host')
    })

    await test.step('the config file holds each saved value, and the password only sealed', async () => {
      expectFileHoldsSavedValues()
    })

    await first.stop()
    const second = await spawnBackend({ reuse: first })
    expectRunning(second)
    expect(second.configFile).toBe(file)

    await test.step('every value reads back from the restarted backend', async () => {
      expect((await read(request, `${second.baseUrl}/admin/log-level`)).level).toBe('DEBUG')
      expect(await read(request, `${second.baseUrl}/admin/secret-masking`)).toMatchObject({
        run_output: true,
        test_variables: false,
        shared_variables: false,
        credential_inputs: false,
      })
      expect(await read(request, `${second.baseUrl}/mcp/settings`)).toMatchObject({
        enabled: false,
        port: 8799,
        bind: 'local',
        auth_enabled: true,
        auth_username: MCP_USERNAME,
        auth_password_set: true,
      })
      expect(await schedule(request, second)).toMatchObject({
        enabled: true,
        cron: YEARLY_CRON,
        save_directory: backups,
      })
      expect(await read(request, `${second.baseUrl}/network/ssh-hosts/policy`)).toEqual({
        lock_trusted_hosts: false,
        default_block_action: 'strict',
      })
      const certificates = await read(request, `${second.baseUrl}/network/certificates`)
      expect((certificates.settings as Json).public_source).toBe('host')
    })

    await test.step('the config file still holds each saved value after the restart', async () => {
      expectFileHoldsSavedValues()
    })

    await test.step('a saved schedule starts its scheduler again after the restart', async () => {
      const nextRun = (await schedule(request, second)).next_run as string
      expect(nextRun).toMatch(/^\d{4}-01-01T03:00:00\+00:00$/)
      await expect
        .poll(() => second.output())
        .toMatch(logLine('INFO', 'Periodic backup scheduler task created'))
      const nextRunLine = new RegExp(
        `${escapeRegExp(`Next periodic backup at ${nextRun} (in `)}\\d+${escapeRegExp(' seconds)')}`
      )
      await expect.poll(() => second.output()).toMatch(logLine('INFO', nextRunLine))
    })
  })

  test('STARTUP-9: WAVE_LOG_LEVEL wins at every start and a saved level applies at once', async ({
    request,
  }) => {
    const env = { WAVE_LOG_LEVEL: 'WARN' }
    const first = await spawnBackend({ env })
    expectRunning(first)
    const file = first.configFile

    await test.step('the variable beats the level in the file', async () => {
      expect(configSection(file, 'logging')).toMatch(/^  level: INFO$/m)
      expect((await read(request, `${first.baseUrl}/admin/log-level`)).level).toBe('WARN')
    })

    await test.step('a saved level is in force at once and written to the file', async () => {
      const saved = await save(request, 'put', `${first.baseUrl}/admin/log-level`, {
        level: 'DEBUG',
      })
      expect(saved.level).toBe('DEBUG')
      expect((await read(request, `${first.baseUrl}/admin/log-level`)).level).toBe('DEBUG')
      expect(configSection(file, 'logging')).toMatch(/^  level: DEBUG$/m)
    })

    await test.step('the next start is at the level of the variable, the file unchanged', async () => {
      await first.stop()
      const second = await spawnBackend({ reuse: first, env })
      expectRunning(second)
      expect((await read(request, `${second.baseUrl}/admin/log-level`)).level).toBe('WARN')
      expect(configSection(file, 'logging')).toMatch(/^  level: DEBUG$/m)
    })
  })

  test('STARTUP-10: a fresh config file gives the schedule and SSH policy defaults', async ({
    request,
  }) => {
    async function expectDefaults(backend: SpawnedBackend): Promise<void> {
      expectRunning(backend)
      const stored = await schedule(request, backend)
      expect(stored.entity_types).toEqual(BACKUP_ENTITY_TYPES)
      expect(stored.save_directory).toBe('~/wave-backups')
      expect(stored).toMatchObject({ enabled: false, cron: '', next_run: null })
      expect(await read(request, `${backend.baseUrl}/network/ssh-hosts/policy`)).toEqual({
        lock_trusted_hosts: false,
        default_block_action: 'disabled',
      })
    }

    await test.step('the example with a throwaway key', async () => {
      const backend = await spawnBackend()
      expect(configSection(backend.configFile, 'backup')).toMatch(/^    entity_types: null$/m)
      await expectDefaults(backend)
    })

    await test.step('a file without the network and backup sections', async () => {
      const configText = withoutSections(EXAMPLE_CONFIG_TEXT, ['network', 'backup'])
      expect(configText).not.toMatch(/^(network|backup):/m)
      expect(configText).toMatch(/^storage:$/m)
      await expectDefaults(await spawnBackend({ configText }))
    })
  })

  test('STARTUP-11: unknown keys and an unknown section survive a Save untouched', async ({
    request,
  }) => {
    const configText =
      EXAMPLE_CONFIG_TEXT.replace(
        'mcp:\n  enabled: false',
        'mcp:\n  e2e_unknown_key: kept\n  enabled: false'
      ).replace(
        '    lock_trusted_hosts: false',
        '    e2e_unknown_key: kept\n    lock_trusted_hosts: false'
      ) + UNKNOWN_SECTION
    expect(configText.match(/e2e_unknown/g)).toHaveLength(3)

    const backend = await spawnBackend({ configText })

    await test.step('the backend starts and ignores what it does not know', async () => {
      expectRunning(backend)
      expect((await request.get(`${backend.baseUrl}/health`)).status()).toBe(200)
      expect(await read(request, `${backend.baseUrl}/mcp/settings`)).toMatchObject({
        enabled: false,
        port: 8765,
      })
      expect(await read(request, `${backend.baseUrl}/network/ssh-hosts/policy`)).toEqual({
        lock_trusted_hosts: false,
        default_block_action: 'disabled',
      })
    })

    await test.step('a Save changes its own line and nothing else', async () => {
      await save(request, 'put', `${backend.baseUrl}/admin/log-level`, { level: 'DEBUG' })
      expect(readConfigText(backend.configFile)).toBe(
        configText.replace('\n  level: INFO\n', '\n  level: DEBUG\n')
      )
    })
  })

  test('STARTUP-12: turning the periodic backup schedule off stops the scheduler', async ({
    request,
  }) => {
    const backend = await spawnBackend()
    expectRunning(backend)
    const url = `${backend.baseUrl}/api/backup/schedule`

    await save(request, 'put', url, {
      enabled: true,
      cron: YEARLY_CRON,
      save_directory: backupFolder(backend),
    })
    await expect
      .poll(() => backend.output())
      .toMatch(logLine('INFO', 'Periodic backup scheduler task created'))

    const before = backend.output().length
    const off = await save(request, 'put', url, { enabled: false })

    // Off keeps none of the settings the page hides (REQ-4.7.16, SHELL-10).
    expect(off.data).toMatchObject({ enabled: false, cron: '', next_run: null })
    await expect
      .poll(() => backend.output().slice(before))
      .toMatch(logLine('INFO', 'Periodic backup scheduler stopped'))
    await expect
      .poll(() => backend.output().slice(before))
      .toMatch(logLine('INFO', 'No active periodic backup schedule'))
    expect(await schedule(request, backend)).toMatchObject({ enabled: false, next_run: null })
  })

  test('STARTUP-13: no secret encryption key stops the start', async () => {
    const configText = SHIPPED_EXAMPLE_CONFIG_TEXT.replace('\n  secret_key: ""\n', '\n')
    expect(configText).not.toMatch(/^\s*secret_key:/m)
    expect(configText).toMatch(/^security:$/m)
    const backend = await spawnBackend({ configText })

    expectRefusal(backend, NO_KEY_REFUSAL)
  })

  test('STARTUP-13b: the example config exactly as shipped stops the start', async () => {
    expect(SHIPPED_EXAMPLE_CONFIG_TEXT).toMatch(/^  secret_key: ""$/m)
    const backend = await spawnBackend({ configText: SHIPPED_EXAMPLE_CONFIG_TEXT })

    expectRefusal(backend, NO_KEY_REFUSAL)
  })

  test('STARTUP-14: a secret encryption key that is not 32 bytes of base64 stops the start', async () => {
    const message =
      'Secret encryption key must be a base64-encoded 32-byte value. Check WAVE_SECRET_KEY / security.secret_key.'

    await test.step('text that is not base64', async () => {
      expectRefusal(await spawnBackend({ env: { WAVE_SECRET_KEY: 'not base64 at all!' } }), message)
    })

    await test.step('16 bytes of base64', async () => {
      const sixteenBytes = randomBytes(16).toString('base64')
      expectRefusal(await spawnBackend({ env: { WAVE_SECRET_KEY: sixteenBytes } }), message)
    })
  })

  test('STARTUP-15: another key on a data folder that holds the key sentinel stops the start', async () => {
    const first = await spawnBackend()
    expectRunning(first)
    expect(
      fs.existsSync(path.join(first.dataDir, 'secret_key_sentinel.yaml')),
      'the first start left the key sentinel in the data folder'
    ).toBe(true)
    await first.stop()

    const anotherKey = randomBytes(32).toString('base64')
    expect(readConfigText(first.configFile)).not.toContain(anotherKey)
    const second = await spawnBackend({ reuse: first, env: { WAVE_SECRET_KEY: anotherKey } })

    expectRefusal(second, /.*does not decrypt existing sealed data.*/)
  })

  test('STARTUP-16: no data folder set stops the start', async () => {
    const configText = withoutSections(EXAMPLE_CONFIG_TEXT, ['storage'])
    expect(configText).not.toMatch(/^storage:/m)
    expect(configText).toMatch(/^security:$/m)
    const backend = await spawnBackend({ configText })

    expectRefusal(
      backend,
      'Data folder not set: add storage.base_path to the config file or set WAVE_STORAGE_BASE_PATH'
    )
    expect(fs.existsSync(backend.dataDir), 'no data folder is made').toBe(false)
  })

  test('STARTUP-17: a relative WAVE_STORAGE_BASE_PATH stops the start', async () => {
    const backend = await spawnBackend({ env: { WAVE_STORAGE_BASE_PATH: 'data' } })

    expectRefusal(backend, 'WAVE_STORAGE_BASE_PATH must be an absolute path: data')
  })

  test('STARTUP-18: a data folder under a plain file stops the start', async () => {
    // A relative base_path starts at the config file's folder, so the config file is the plain file.
    const configText = EXAMPLE_CONFIG_TEXT.replace(
      '\n  base_path: ../data\n',
      '\n  base_path: config.yaml/data\n'
    )
    expect(configText).toMatch(/^  base_path: config\.yaml\/data$/m)
    const backend = await spawnBackend({ configText })

    // The reason is the system's own wording.
    const prefix = escapeRegExp(`Data folder ${path.join(backend.configFile, 'data')} cannot be created: `)
    expectRefusal(backend, new RegExp(`${prefix}\\S.*`))
    expect(fs.statSync(backend.configFile).isFile(), 'the config file is still a file').toBe(true)
  })
})
